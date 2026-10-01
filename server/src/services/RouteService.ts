import {
  addSeconds,
  diffSeconds,
  floorToMinute,
  formatClock,
  parseGoogleDuration,
  toInstant,
  type GroundSegment,
  type ModeResult,
  type PlaceSummary,
  type RouteOption,
  type RouteRequest,
} from '@nexus/shared';
import { TtlCache, cacheKey } from '../lib/cache';
import { FIELD_MASKS, type GoogleRoutesClient } from '../providers/google/GoogleRoutesClient';
import type {
  ComputeRoutesBody,
  RawComputeRoutesResponse,
  RawGeocodedWaypoint,
  RawRoute,
} from '../providers/google/routesTypes';
import {
  mapSteps,
  mapTolls,
  mapTrafficIntervals,
  polylinePointCount,
  toWaypoint,
  viewportToBounds,
  type Endpoint,
} from './mappers/routeMapper';
import { solveDepartureForArrival } from './ScheduleService';
import { describeTraffic } from './TrafficService';

export const ROUTES_PROVIDER = 'Google Routes API';

export const WALK_BETA_WARNING =
  'Rotas a pé estão em beta na Routes API e podem não incluir calçadas ou caminhos de pedestres claramente identificados. Confira as condições reais do trajeto.';

export interface RouteServiceOptions {
  languageCode: string;
  regionCode: string;
  trafficOnPolyline: boolean;
  tolls: boolean;
  now?: () => Date;
}

/** Margem para tratar "sair às" muito próximo de agora como "agora" (a API recusa saída no passado). */
const NOW_SLACK_S = 60;

export interface DriveLegResult {
  segment: GroundSegment;
  /** true = o terminal não pôde ser geocodificado e foi usada a coordenada de referência. */
  usedReferencePoint: boolean;
  durationSeconds: number;
  departure: string;
  arrival: string;
}

/**
 * Rotas de carro e a pé via Routes API. Nunca desenha linha reta: sem resposta do
 * mecanismo de rotas, o modo é marcado como indisponível.
 */
export class RouteService {
  private readonly estimateCache = new TtlCache<number>(2 * 60_000, 2_000);
  private readonly now: () => Date;

  constructor(
    private readonly routes: GoogleRoutesClient,
    private readonly opts: RouteServiceOptions,
  ) {
    this.now = opts.now ?? (() => new Date());
  }

  get configured(): boolean {
    return this.routes.configured;
  }

  /* ------------------------------------------------------------------ carro */

  async drive(req: RouteRequest, signal?: AbortSignal): Promise<ModeResult> {
    const now = this.now();
    const nowIso = toInstant(now);
    let apiCalls = 0;
    let departure: string | undefined;
    let scheduleNote: string | undefined;
    let method: string;

    if (req.time.mode === 'depart_at' && req.time.instant && diffSeconds(nowIso, req.time.instant) > NOW_SLACK_S) {
      departure = req.time.instant;
      method = 'Saída no horário escolhido; duração com previsão de trânsito para esse horário (TRAFFIC_AWARE + departureTime).';
    } else if (req.time.mode === 'arrive_by' && req.time.instant) {
      const deadline = req.time.instant;
      const solution = await solveDepartureForArrival({
        deadline,
        now,
        estimate: async (dep) => {
          apiCalls++;
          return this.estimateDriveSeconds(req.origin, req.destination, dep, signal);
        },
      });
      if (solution.feasible) {
        departure = diffSeconds(nowIso, solution.departure) > NOW_SLACK_S ? solution.departure : undefined;
      } else {
        scheduleNote = `Para chegar até ${formatClock(deadline, req.destination.timeZone)} seria necessário sair às ${formatClock(solution.requiredDeparture, req.origin.timeZone)}, horário que já passou. Exibindo a saída agora.`;
      }
      method = `A Routes API não aceita horário de chegada para carro. A saída foi calculada por iteração (saída = limite − duração prevista para aquela saída), com ${apiCalls} consulta(s) de estimativa.`;
    } else {
      method = 'Saída agora; duração com o trânsito atual (TRAFFIC_AWARE).';
    }

    let res = await this.computeDriveFull(req, departure, signal);
    apiCalls++;

    // "Chegar até": se a rota principal ainda ultrapassa o prazo (variação do trânsito entre
    // a estimativa e a chamada final), faz uma única correção com a duração final.
    if (req.time.mode === 'arrive_by' && req.time.instant && departure) {
      const main = res.routes?.[0];
      const mainDuration = parseGoogleDuration(main?.duration);
      if (mainDuration !== undefined && diffSeconds(addSeconds(departure, mainDuration), req.time.instant) < 0) {
        const corrected = floorToMinute(addSeconds(req.time.instant, -mainDuration));
        if (diffSeconds(nowIso, corrected) > NOW_SLACK_S) {
          departure = corrected;
          res = await this.computeDriveFull(req, departure, signal);
          apiCalls++;
        }
      }
    }

    const routes = res.routes ?? [];
    const dep = departure ?? nowIso;
    const options = routes.map((route, i) =>
      this.toGroundOption('drive', route, i, dep, req, {
        traffic: describeTraffic(route, { departsNow: departure === undefined, fallback: res.fallbackInfo }),
        tolls: mapTolls(route, this.opts.tolls),
        scheduleNote,
        withTraffic: this.opts.trafficOnPolyline,
      }),
    );

    return {
      mode: 'drive',
      status: options.length > 0 ? 'available' : 'unavailable',
      message: options.length > 0 ? undefined : 'Não encontramos uma rota de carro entre esses pontos.',
      options,
      warnings: [],
      provider: ROUTES_PROVIDER,
      timing: { requested: req.time, method, apiCalls },
    };
  }

  /**
   * Trecho de carro usado em viagens multimodais (ex.: até o aeroporto). Usa SKU Pro
   * (TRAFFIC_AWARE sem extras) com polilinha e passos.
   */
  async driveLeg(
    origin: Endpoint,
    destination: Endpoint,
    departure: string | undefined,
    label: string,
    signal?: AbortSignal,
  ): Promise<DriveLegResult | null> {
    const nowIso = toInstant(this.now());
    const dep = departure && diffSeconds(nowIso, departure) > NOW_SLACK_S ? departure : undefined;
    const { res, usedReferencePoint } = await this.computeWithEndpoints(
      origin,
      destination,
      (o, d) => ({
        ...this.baseBodyFor(o, d, 'DRIVE'),
        routingPreference: 'TRAFFIC_AWARE',
        polylineQuality: 'HIGH_QUALITY',
        ...(dep ? { departureTime: dep } : {}),
      }),
      FIELD_MASKS.leg,
      signal,
    );
    const route = res.routes?.[0];
    const duration = parseGoogleDuration(route?.duration);
    if (!route || duration === undefined || !route.polyline?.encodedPolyline) return null;
    const start = dep ?? nowIso;
    const end = addSeconds(start, duration);
    return {
      durationSeconds: duration,
      departure: start,
      arrival: end,
      usedReferencePoint,
      segment: {
        kind: 'drive',
        label,
        polyline: route.polyline.encodedPolyline,
        distanceMeters: route.distanceMeters ?? 0,
        durationSeconds: duration,
        staticDurationSeconds: parseGoogleDuration(route.staticDuration),
        steps: mapSteps(route.legs?.[0]?.steps),
        departure: { instant: start, timeZone: origin.timeZone },
        arrival: { instant: end, timeZone: destination.timeZone },
      },
    };
  }

  /** Duração prevista de carro (SKU Pro, field mask mínima). Cache curto. */
  async estimateDriveSeconds(
    origin: Endpoint,
    destination: Endpoint,
    departure: string | undefined,
    signal?: AbortSignal,
  ): Promise<number> {
    const nowIso = toInstant(this.now());
    const dep = departure && diffSeconds(nowIso, departure) > NOW_SLACK_S ? departure : undefined;
    const key = cacheKey([
      'est',
      origin.id ?? origin.addressQuery ?? origin.location,
      destination.id ?? destination.addressQuery ?? destination.location,
      dep ?? 'now',
    ]);
    return this.estimateCache.getOrLoad(key, async () => {
      const { res } = await this.computeWithEndpoints(
        origin,
        destination,
        (o, d) => ({
          ...this.baseBodyFor(o, d, 'DRIVE'),
          routingPreference: 'TRAFFIC_AWARE',
          ...(dep ? { departureTime: dep } : {}),
        }),
        FIELD_MASKS.durationOnly,
        signal,
      );
      const seconds = parseGoogleDuration(res.routes?.[0]?.duration);
      if (seconds === undefined) throw new NoRouteError('drive');
      return seconds;
    });
  }

  /**
   * Endpoints com `addressQuery` (aeroportos) são geocodificados pela própria Routes API.
   * O resultado só é aceito se o tipo geocodificado for o esperado (ex.: "airport");
   * caso contrário, repete com a coordenada de referência e sinaliza isso.
   */
  private async computeWithEndpoints(
    origin: Endpoint,
    destination: Endpoint,
    build: (o: Endpoint, d: Endpoint) => ComputeRoutesBody,
    fieldMask: string,
    signal?: AbortSignal,
  ): Promise<{ res: RawComputeRoutesResponse; usedReferencePoint: boolean }> {
    const needsCheck = !!(origin.addressQuery || destination.addressQuery);
    if (!needsCheck) return { res: await this.routes.computeRoutes(build(origin, destination), fieldMask, signal), usedReferencePoint: false };

    const res = await this.routes.computeRoutes(build(origin, destination), `${fieldMask},geocodingResults`, signal);
    const ok =
      geocodeMatches(origin, res.geocodingResults?.origin) && geocodeMatches(destination, res.geocodingResults?.destination);
    if (ok && res.routes?.length) return { res, usedReferencePoint: false };
    const strip = (e: Endpoint): Endpoint => ({ ...e, addressQuery: undefined });
    return {
      res: await this.routes.computeRoutes(build(strip(origin), strip(destination)), fieldMask, signal),
      usedReferencePoint: true,
    };
  }

  /* ------------------------------------------------------------------- a pé */

  async walk(req: RouteRequest, signal?: AbortSignal): Promise<ModeResult> {
    const nowIso = toInstant(this.now());
    const departAt =
      req.time.mode === 'depart_at' && req.time.instant && diffSeconds(nowIso, req.time.instant) > NOW_SLACK_S
        ? req.time.instant
        : undefined;
    const body: ComputeRoutesBody = {
      ...this.baseBody(req.origin, req.destination, 'WALK'),
      computeAlternativeRoutes: true,
      polylineQuality: 'HIGH_QUALITY',
      ...(departAt ? { departureTime: departAt } : {}),
    };
    const res = await this.routes.computeRoutes(body, FIELD_MASKS.walk, signal);
    const routes = res.routes ?? [];
    let method = 'Duração de caminhada estimada pelo mecanismo de rotas (não depende de trânsito).';

    const options = routes.map((route, i) => {
      const duration = parseGoogleDuration(route.duration) ?? 0;
      let dep = departAt ?? nowIso;
      let scheduleNote: string | undefined;
      if (req.time.mode === 'arrive_by' && req.time.instant) {
        const needed = floorToMinute(addSeconds(req.time.instant, -duration));
        if (diffSeconds(nowIso, needed) >= -NOW_SLACK_S) {
          dep = diffSeconds(nowIso, needed) > 0 ? needed : nowIso;
        } else {
          scheduleNote = `Para chegar até ${formatClock(req.time.instant, req.destination.timeZone)} seria necessário sair às ${formatClock(needed, req.origin.timeZone)}, horário que já passou. Exibindo a saída agora.`;
        }
        method = 'Saída = horário-limite − duração da caminhada informada pela Routes API.';
      }
      return this.toGroundOption('walk', route, i, dep, req, {
        traffic: { freshness: 'static', note: 'Tempo de caminhada estimado pelo mecanismo de rotas; não usa dados de trânsito.' },
        scheduleNote,
        withTraffic: false,
        extraWarnings: [WALK_BETA_WARNING],
      });
    });

    return {
      mode: 'walk',
      status: options.length > 0 ? 'available' : 'unavailable',
      message: options.length > 0 ? undefined : 'Não encontramos uma rota a pé entre esses pontos.',
      options,
      warnings: options.length > 0 ? [WALK_BETA_WARNING] : [],
      provider: ROUTES_PROVIDER,
      timing: { requested: req.time, method, apiCalls: 1 },
    };
  }

  /* --------------------------------------------------------------- internos */

  private baseBody(origin: PlaceSummary, destination: PlaceSummary, travelMode: ComputeRoutesBody['travelMode']) {
    return this.baseBodyFor(origin, destination, travelMode);
  }

  private baseBodyFor(origin: Endpoint, destination: Endpoint, travelMode: ComputeRoutesBody['travelMode']) {
    return {
      origin: toWaypoint(origin),
      destination: toWaypoint(destination),
      travelMode,
      languageCode: this.opts.languageCode,
      regionCode: this.opts.regionCode,
      units: 'METRIC' as const,
    };
  }

  private computeDriveFull(req: RouteRequest, departure: string | undefined, signal?: AbortSignal): Promise<RawComputeRoutesResponse> {
    const extra: ComputeRoutesBody['extraComputations'] = [];
    if (this.opts.trafficOnPolyline) extra.push('TRAFFIC_ON_POLYLINE');
    if (this.opts.tolls) extra.push('TOLLS');
    const body: ComputeRoutesBody = {
      ...this.baseBody(req.origin, req.destination, 'DRIVE'),
      routingPreference: 'TRAFFIC_AWARE',
      computeAlternativeRoutes: true,
      polylineQuality: 'HIGH_QUALITY',
      ...(extra.length > 0 ? { extraComputations: extra } : {}),
      ...(departure ? { departureTime: departure } : {}),
    };
    return this.routes.computeRoutes(body, FIELD_MASKS.drive, signal);
  }

  private toGroundOption(
    mode: 'drive' | 'walk',
    route: RawRoute,
    index: number,
    departure: string,
    req: RouteRequest,
    extra: {
      traffic: RouteOption['traffic'];
      tolls?: RouteOption['tolls'];
      scheduleNote?: string;
      withTraffic: boolean;
      extraWarnings?: string[];
    },
  ): RouteOption {
    const duration = parseGoogleDuration(route.duration) ?? 0;
    const staticDuration = parseGoogleDuration(route.staticDuration);
    const encoded = route.polyline?.encodedPolyline ?? '';
    const arrival = addSeconds(departure, duration);
    const segment: GroundSegment = {
      kind: mode,
      polyline: encoded,
      distanceMeters: route.distanceMeters ?? 0,
      durationSeconds: duration,
      staticDurationSeconds: staticDuration,
      steps: mapSteps(route.legs?.flatMap((l) => l.steps ?? [])),
      traffic: extra.withTraffic
        ? mapTrafficIntervals(route.travelAdvisory?.speedReadingIntervals, polylinePointCount(encoded))
        : undefined,
      departure: { instant: departure, timeZone: req.origin.timeZone },
      arrival: { instant: arrival, timeZone: req.destination.timeZone },
    };
    return {
      id: `${mode}-${index}`,
      mode,
      summary: route.description || undefined,
      departure: { instant: departure, timeZone: req.origin.timeZone },
      arrival: { instant: arrival, timeZone: req.destination.timeZone },
      durationSeconds: duration,
      staticDurationSeconds: staticDuration,
      distanceMeters: route.distanceMeters,
      traffic: extra.traffic,
      tolls: extra.tolls,
      segments: [segment],
      bounds: viewportToBounds(route),
      warnings: [...(extra.extraWarnings ?? []), ...(route.warnings ?? [])],
      isDefault: route.routeLabels?.includes('DEFAULT_ROUTE') ?? index === 0,
      scheduleNote: extra.scheduleNote,
    };
  }
}

export class NoRouteError extends Error {
  constructor(readonly mode: string) {
    super(`Sem rota (${mode})`);
    this.name = 'NoRouteError';
  }
}

function geocodeMatches(endpoint: Endpoint, geocoded: RawGeocodedWaypoint | undefined): boolean {
  if (!endpoint.addressQuery) return true;
  if (!geocoded || geocoded.partialMatch) return false;
  if (geocoded.geocoderStatus?.code) return false;
  return endpoint.expectedType ? (geocoded.type ?? []).includes(endpoint.expectedType) : true;
}
