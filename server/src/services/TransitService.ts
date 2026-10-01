import {
  addSeconds,
  decodePolyline,
  diffSeconds,
  encodePolyline,
  parseGoogleDuration,
  type GroundSegment,
  type ModeResult,
  type NavigationStep,
  type RouteOption,
  type RouteRequest,
  type Segment,
  type TransitSegment,
} from '@nexus/shared';
import { FIELD_MASKS, type GoogleRoutesClient } from '../providers/google/GoogleRoutesClient';
import type { ComputeRoutesBody, RawRoute, RawStep } from '../providers/google/routesTypes';
import { fromRawLocation, mapSteps, moneyToNumber, toWaypoint, viewportToBounds } from './mappers/routeMapper';
import { ROUTES_PROVIDER } from './RouteService';

/**
 * TransitVehicle.type considerados "metrô / transporte ferroviário".
 * BUS, INTERCITY_BUS, TROLLEYBUS, SHARE_TAXI, FERRY, CABLE_CAR, GONDOLA_LIFT,
 * FUNICULAR e OTHER ficam de fora.
 */
export const RAIL_VEHICLE_TYPES = new Set([
  'SUBWAY',
  'METRO_RAIL',
  'HEAVY_RAIL',
  'COMMUTER_TRAIN',
  'RAIL',
  'HIGH_SPEED_TRAIN',
  'LONG_DISTANCE_TRAIN',
  'MONORAIL',
  'TRAM',
]);

/** Abstração para permitir outros provedores (ex.: GTFS próprio via OpenTripPlanner). */
export interface TransitProvider {
  readonly name: string;
  readonly configured: boolean;
  rail(req: RouteRequest, signal?: AbortSignal): Promise<ModeResult>;
}

export interface TransitServiceOptions {
  languageCode: string;
  regionCode: string;
}

/** Limites documentados para TRANSIT: até 7 dias no passado e 100 dias no futuro. */
export const TRANSIT_MAX_DAYS_AHEAD = 100;

export class GoogleTransitService implements TransitProvider {
  readonly name = ROUTES_PROVIDER;

  constructor(
    private readonly routes: GoogleRoutesClient,
    private readonly opts: TransitServiceOptions,
  ) {}

  get configured(): boolean {
    return this.routes.configured;
  }

  async rail(req: RouteRequest, signal?: AbortSignal): Promise<ModeResult> {
    const body: ComputeRoutesBody = {
      origin: toWaypoint(req.origin),
      destination: toWaypoint(req.destination),
      travelMode: 'TRANSIT',
      computeAlternativeRoutes: true,
      polylineQuality: 'HIGH_QUALITY',
      languageCode: this.opts.languageCode,
      regionCode: this.opts.regionCode,
      units: 'METRIC',
      // Pedimos somente trilhos; a documentação avisa que a API ainda pode devolver outros
      // veículos, então cada rota é verificada abaixo.
      transitPreferences: { allowedTravelModes: ['SUBWAY', 'TRAIN', 'LIGHT_RAIL', 'RAIL'] },
    };
    let method = 'Próxima opção a partir de agora (horários do provedor de transporte público).';
    if (req.time.mode === 'depart_at' && req.time.instant) {
      body.departureTime = req.time.instant;
      method = 'Opções compatíveis com o horário de saída escolhido (departureTime).';
    } else if (req.time.mode === 'arrive_by' && req.time.instant) {
      body.arrivalTime = req.time.instant;
      method = 'Opções que chegam até o horário escolhido (arrivalTime nativo da Routes API para TRANSIT).';
    }

    const res = await this.routes.computeRoutes(body, FIELD_MASKS.transit, signal);
    const routes = res.routes ?? [];
    const options: RouteOption[] = [];
    let excludedNonRail = 0;
    let excludedWalkOnly = 0;

    routes.forEach((route, i) => {
      const built = buildTransitOption(route, i, req);
      if (built.kind === 'ok') options.push(built.option);
      else if (built.kind === 'non_rail') excludedNonRail++;
      else excludedWalkOnly++;
    });

    const warnings: string[] = [];
    if (excludedNonRail > 0 && options.length > 0) {
      warnings.push(`${excludedNonRail} opção(ões) do provedor usava(m) ônibus ou outro veículo não ferroviário e foi(ram) omitida(s).`);
    }

    let message: string | undefined;
    if (options.length === 0) {
      if (excludedNonRail > 0) {
        message = 'Não há rota de metrô / trilhos disponível para este trajeto. O provedor só encontrou opções que dependem de ônibus ou outros veículos.';
      } else if (excludedWalkOnly > 0) {
        message = 'Não há rota de metrô / trilhos disponível para este trajeto (o provedor sugeriu apenas caminhar).';
      } else {
        message = 'Não há rota de metrô / trilhos disponível para este trajeto. Isso também acontece quando a cidade não publica dados de transporte para o provedor.';
      }
    }

    return {
      mode: 'rail',
      status: options.length > 0 ? 'available' : 'unavailable',
      message,
      options,
      warnings,
      provider: ROUTES_PROVIDER,
      timing: { requested: req.time, method, apiCalls: 1 },
    };
  }
}

type BuildResult = { kind: 'ok'; option: RouteOption } | { kind: 'non_rail' } | { kind: 'walk_only' };

/** Converte uma rota TRANSIT em opção, agrupando passos de caminhada e validando os veículos. */
export function buildTransitOption(route: RawRoute, index: number, req: RouteRequest): BuildResult {
  const steps = route.legs?.flatMap((l) => l.steps ?? []) ?? [];
  type Draft = { kind: 'walk'; steps: RawStep[] } | { kind: 'transit'; step: RawStep };
  const drafts: Draft[] = [];
  for (const step of steps) {
    if (step.travelMode === 'TRANSIT' && step.transitDetails) {
      drafts.push({ kind: 'transit', step });
    } else {
      const last = drafts[drafts.length - 1];
      if (last?.kind === 'walk') last.steps.push(step);
      else drafts.push({ kind: 'walk', steps: [step] });
    }
  }

  const transitDrafts = drafts.filter((d): d is Extract<Draft, { kind: 'transit' }> => d.kind === 'transit');
  if (transitDrafts.length === 0) return { kind: 'walk_only' };
  const allRail = transitDrafts.every((d) =>
    RAIL_VEHICLE_TYPES.has(d.step.transitDetails?.transitLine?.vehicle?.type ?? ''),
  );
  if (!allRail) return { kind: 'non_rail' };

  // Horários: os trechos de veículo trazem horários reais; a caminhada usa a duração informada.
  const segments: Segment[] = [];
  const transitSegments: TransitSegment[] = [];
  for (const d of drafts) {
    if (d.kind === 'transit') {
      const seg = mapTransitStep(d.step);
      if (!seg) return { kind: 'non_rail' };
      transitSegments.push(seg);
      segments.push(seg);
    } else {
      segments.push(walkSegmentFrom(d.steps));
    }
  }

  // Encadeia os horários das caminhadas em torno dos trechos com horário.
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!;
    if (s.kind !== 'walk') continue;
    const prev = segments[i - 1];
    const next = segments[i + 1];
    if (prev && prev.kind === 'transit') {
      s.departure = { instant: prev.arrival.instant, timeZone: prev.arrival.timeZone };
      s.arrival = { instant: addSeconds(prev.arrival.instant, s.durationSeconds), timeZone: i === segments.length - 1 ? req.destination.timeZone : prev.arrival.timeZone };
    } else if (next && next.kind === 'transit') {
      s.departure = { instant: addSeconds(next.departure.instant, -s.durationSeconds), timeZone: req.origin.timeZone };
      s.arrival = { instant: next.departure.instant, timeZone: next.departure.timeZone };
    }
  }

  const first = segments[0]!;
  const last = segments[segments.length - 1]!;
  const departure =
    first.kind === 'walk' && first.departure ? first.departure.instant : transitSegments[0]!.departure.instant;
  const arrival =
    last.kind === 'walk' && last.arrival ? last.arrival.instant : transitSegments[transitSegments.length - 1]!.arrival.instant;

  const fare = route.travelAdvisory?.transitFare;
  const warnings = [...(route.warnings ?? [])];
  if (fare?.currencyCode) {
    warnings.push(
      `Tarifa informada pelo provedor: ${moneyToNumber(fare).toLocaleString('pt-BR', { style: 'currency', currency: fare.currencyCode })}.`,
    );
  }

  return {
    kind: 'ok',
    option: {
      id: `rail-${index}`,
      mode: 'rail',
      departure: { instant: departure, timeZone: req.origin.timeZone },
      arrival: { instant: arrival, timeZone: req.destination.timeZone },
      durationSeconds: diffSeconds(departure, arrival),
      distanceMeters: route.distanceMeters,
      transfers: transitSegments.length - 1,
      traffic: {
        freshness: 'predicted',
        note: 'Horários do provedor de transporte público (programados ou estimados).',
      },
      segments,
      bounds: viewportToBounds(route),
      warnings,
      isDefault: index === 0,
      summary: transitSegments.map((t) => t.line.shortName ?? t.line.name ?? t.line.vehicleName ?? '').filter(Boolean).join(' → ') || undefined,
      scheduleNote:
        'A saída considera chegar à estação exatamente no horário de embarque; não inclui margem extra.',
    },
  };
}

function mapTransitStep(step: RawStep): TransitSegment | null {
  const td = step.transitDetails!;
  const dep = td.stopDetails?.departureTime;
  const arr = td.stopDetails?.arrivalTime;
  if (!dep || !arr) return null; // sem horário real não exibimos o trecho
  const line = td.transitLine ?? {};
  return {
    kind: 'transit',
    polyline: step.polyline?.encodedPolyline,
    distanceMeters: step.distanceMeters,
    durationSeconds: diffSeconds(dep, arr),
    line: {
      name: line.name,
      shortName: line.nameShort,
      color: line.color,
      textColor: line.textColor,
      vehicleType: line.vehicle?.type ?? 'OTHER',
      vehicleName: line.vehicle?.name?.text,
      agencies: (line.agencies ?? []).map((a) => a.name).filter((n): n is string => !!n),
      iconUri: line.vehicle?.localIconUri ?? line.vehicle?.iconUri ?? line.iconUri,
    },
    departureStop: {
      name: td.stopDetails?.departureStop?.name ?? 'Estação de embarque',
      location: fromRawLocation(td.stopDetails?.departureStop?.location),
    },
    arrivalStop: {
      name: td.stopDetails?.arrivalStop?.name ?? 'Estação de desembarque',
      location: fromRawLocation(td.stopDetails?.arrivalStop?.location),
    },
    departure: { instant: dep, timeZone: td.localizedValues?.departureTime?.timeZone },
    arrival: { instant: arr, timeZone: td.localizedValues?.arrivalTime?.timeZone },
    headsign: td.headsign,
    stopCount: td.stopCount,
    tripShortText: td.tripShortText,
    headwaySeconds: parseGoogleDuration(td.headway),
  };
}

function walkSegmentFrom(steps: RawStep[]): GroundSegment {
  const path = steps.flatMap((s) => decodePolyline(s.polyline?.encodedPolyline ?? ''));
  const navSteps: NavigationStep[] = mapSteps(steps);
  return {
    kind: 'walk',
    polyline: encodePolyline(path),
    distanceMeters: steps.reduce((acc, s) => acc + (s.distanceMeters ?? 0), 0),
    durationSeconds: steps.reduce((acc, s) => acc + (parseGoogleDuration(s.staticDuration) ?? 0), 0),
    steps: navSteps,
  };
}
