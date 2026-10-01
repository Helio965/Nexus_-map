import {
  addSeconds,
  boundsOf,
  decodePolyline,
  diffSeconds,
  formatDuration,
  haversineMeters,
  toInstant,
  type AirportInfo,
  type FlightRouteRequest,
  type FlightSearchMeta,
  type ModeResult,
  type RouteOption,
  type Segment,
} from '@nexus/shared';
import { AppError } from '../lib/errors';
import type { AirportDirectory, NearbyAirport } from '../providers/airports/AirportDirectory';
import type { FlightProvider, ScheduledFlight } from '../providers/flights/FlightProvider';
import type { Endpoint } from './mappers/routeMapper';
import { NoRouteError, type RouteService } from './RouteService';
import type { TimeZoneService } from './TimeZoneService';

export interface FlightServiceOptions {
  minDistanceKm: number;
  airportSearchRadiusKm: number;
  maxAirportsPerSide: number;
  maxOptions: number;
  now?: () => Date;
}

const DAY_S = 86_400;

interface AirportWithGround extends NearbyAirport {
  timeZone?: string;
  /** Duração estimada de carro (s) origem→aeroporto ou aeroporto→destino. */
  groundSeconds: number;
}

/**
 * Viagem aérea multimodal: carro até o aeroporto → margem do usuário → voo direto publicado →
 * margem do usuário → carro até o destino. Sem fonte de voos configurada, nada é exibido.
 */
export class FlightService {
  private readonly now: () => Date;

  constructor(
    private readonly provider: FlightProvider,
    private readonly airports: AirportDirectory,
    private readonly routes: RouteService,
    private readonly timeZones: TimeZoneService,
    private readonly opts: FlightServiceOptions,
  ) {
    this.now = opts.now ?? (() => new Date());
  }

  get providerName(): string {
    return this.provider.name;
  }

  async flight(req: FlightRouteRequest, signal?: AbortSignal): Promise<ModeResult> {
    const base = {
      mode: 'flight' as const,
      options: [],
      warnings: [],
      provider: this.provider.name,
    };
    if (!this.provider.configured) {
      return {
        ...base,
        status: 'not_configured',
        message:
          'Busca de voos não configurada no servidor (FLIGHTAWARE_AEROAPI_KEY). Nenhum voo é exibido sem uma fonte real.',
      };
    }

    const straightKm = haversineMeters(req.origin.location, req.destination.location) / 1000;
    if (straightKm < this.opts.minDistanceKm) {
      return {
        ...base,
        status: 'unavailable',
        message: `Não há rota aérea adequada disponível: a distância em linha reta (${Math.round(straightKm)} km) é menor que o mínimo configurado para buscar voos (${this.opts.minDistanceKm} km).`,
      };
    }

    const radius = this.opts.airportSearchRadiusKm;
    const perSide = this.opts.maxAirportsPerSide;
    const [originNear, destNear] = await Promise.all([
      this.airports.nearest(req.origin.location, radius, perSide),
      this.airports.nearest(req.destination.location, radius, perSide),
    ]);
    if (originNear.length === 0 || destNear.length === 0) {
      const side = originNear.length === 0 ? 'da origem' : 'do destino';
      return {
        ...base,
        status: 'unavailable',
        message: `Não há rota aérea adequada disponível: não encontramos aeroportos com voos regulares a até ${radius} km ${side} (base OurAirports).`,
      };
    }
    const destCodes = new Set(destNear.map((a) => a.iata));
    if (
      originNear.every((a) => destCodes.has(a.iata)) &&
      destNear.every((a) => originNear.some((o) => o.iata === a.iata))
    ) {
      return {
        ...base,
        status: 'unavailable',
        message:
          'Não há rota aérea adequada disponível: origem e destino são atendidos pelo(s) mesmo(s) aeroporto(s).',
      };
    }

    let apiCalls = 0;
    const nowIso = toInstant(this.now());
    const time = req.time;

    // 1) Fusos dos aeroportos (horários de voo chegam em UTC).
    const withZone = async (a: NearbyAirport) => ({
      ...a,
      timeZone: await this.timeZones.zoneFor(a.location, signal).catch((err) => {
        if (signal?.aborted) throw err;
        return undefined;
      }),
    });

    // 2) Estimativas de carro (SKU Pro) até cada aeroporto de origem e de cada aeroporto ao destino.
    const accessDeparture = time.mode === 'depart_at' ? time.instant : undefined;
    const estimate = async (from: Endpoint, to: Endpoint, dep: string | undefined) => {
      apiCalls++;
      try {
        return await this.routes.estimateDriveSeconds(from, to, dep, signal);
      } catch (err) {
        if (err instanceof NoRouteError) return null;
        throw err;
      }
    };
    const originAirports: AirportWithGround[] = [];
    for (const a of await Promise.all(originNear.map(withZone))) {
      const s = await estimate(req.origin, airportEndpoint(a), accessDeparture);
      if (s !== null) originAirports.push({ ...a, groundSeconds: s });
    }
    const destAirports: AirportWithGround[] = [];
    for (const a of await Promise.all(destNear.map(withZone))) {
      const s = await estimate(airportEndpoint(a), req.destination, undefined);
      if (s !== null) destAirports.push({ ...a, groundSeconds: s });
    }

    const meta: FlightSearchMeta = {
      originAirports: originAirports.map(toAirportInfo),
      destinationAirports: destAirports.map(toAirportInfo),
      flightsFound: 0,
      preDepartureMarginMinutes: req.preDepartureMarginMinutes,
      postArrivalMarginMinutes: req.postArrivalMarginMinutes,
      directFlightsOnly: true,
    };
    if (originAirports.length === 0 || destAirports.length === 0) {
      return {
        ...base,
        status: 'unavailable',
        meta,
        message:
          'Não há rota aérea adequada disponível: não há rota terrestre de carro até os aeroportos encontrados.',
      };
    }

    // 3) Janelas de busca e consulta de voos diretos por par de aeroportos.
    const pre = req.preDepartureMarginMinutes * 60;
    const post = req.postArrivalMarginMinutes * 60;
    const maxFuture = addSeconds(nowIso, Math.floor(this.provider.maxFutureMs / 1000));
    const candidates: Array<{
      flight: ScheduledFlight;
      from: AirportWithGround;
      to: AirportWithGround;
      score: number;
    }> = [];
    let flightsFound = 0;

    for (const from of originAirports) {
      for (const to of destAirports) {
        if (from.iata === to.iata) continue;
        const window = this.searchWindow(time, nowIso, from, to, pre, post);
        if (!window) continue;
        if (diffSeconds(window.end, maxFuture) < 0) {
          throw new AppError(
            'VALIDATION',
            'Horários de voos só podem ser consultados até 1 ano à frente.',
          );
        }
        const flights = await this.provider.searchDirectFlights(
          {
            originIata: from.iata,
            destinationIata: to.iata,
            departureWindowStart: window.start,
            departureWindowEnd: window.end,
          },
          signal,
        );
        apiCalls++;
        flightsFound += flights.length;
        for (const f of flights) {
          if (diffSeconds(window.start, f.scheduledOut) < 0) continue;
          if (window.latestIn && diffSeconds(f.scheduledIn, window.latestIn) < 0) continue;
          const score =
            time.mode === 'arrive_by'
              ? // maior = sai de casa mais tarde
                -diffSeconds(nowIso, addSeconds(f.scheduledOut, -(pre + from.groundSeconds)))
              : // menor = chega ao destino mais cedo
                diffSeconds(nowIso, addSeconds(f.scheduledIn, post + to.groundSeconds));
          candidates.push({ flight: f, from, to, score });
        }
      }
    }
    meta.flightsFound = flightsFound;

    if (candidates.length === 0) {
      return {
        ...base,
        status: 'unavailable',
        meta,
        message:
          flightsFound > 0
            ? 'Não encontramos voos diretos compatíveis com o horário escolhido e com as margens definidas.'
            : 'Não encontramos voos diretos publicados entre os aeroportos próximos no período escolhido.',
        timing: { requested: time, method: methodText(), apiCalls },
      };
    }

    candidates.sort((a, b) => a.score - b.score);
    const chosen = candidates.slice(0, this.opts.maxOptions);

    // 4) Trechos terrestres reais para os voos escolhidos.
    const options: RouteOption[] = [];
    const warnings: string[] = [];
    for (const [i, c] of chosen.entries()) {
      const option = await this.buildOption(req, c, i, pre, post, nowIso, signal);
      apiCalls += 2;
      if (option) options.push(option);
    }
    if (options.length === 0) {
      warnings.push(
        'Os voos encontrados não deixam tempo suficiente para o trajeto terrestre até o aeroporto.',
      );
    }

    return {
      ...base,
      status: options.length > 0 ? 'available' : 'unavailable',
      message:
        options.length > 0
          ? undefined
          : 'Não encontramos voos compatíveis com o período escolhido.',
      options,
      warnings,
      meta,
      timing: { requested: time, method: methodText(), apiCalls },
    };
  }

  private searchWindow(
    time: FlightRouteRequest['time'],
    nowIso: string,
    from: AirportWithGround,
    to: AirportWithGround,
    pre: number,
    post: number,
  ): { start: string; end: string; latestIn?: string } | null {
    const earliestOut = addSeconds(
      time.mode === 'depart_at' && time.instant ? time.instant : nowIso,
      from.groundSeconds + pre,
    );
    if (time.mode === 'arrive_by' && time.instant) {
      const latestIn = addSeconds(time.instant, -(to.groundSeconds + post));
      const start = maxIso(earliestOut, addSeconds(latestIn, -DAY_S));
      if (diffSeconds(start, latestIn) <= 0) return null;
      return { start, end: latestIn, latestIn };
    }
    return { start: earliestOut, end: addSeconds(earliestOut, DAY_S) };
  }

  private async buildOption(
    req: FlightRouteRequest,
    c: { flight: ScheduledFlight; from: AirportWithGround; to: AirportWithGround },
    index: number,
    pre: number,
    post: number,
    nowIso: string,
    signal?: AbortSignal,
  ): Promise<RouteOption | null> {
    const { flight, from, to } = c;
    let accessDeparture = addSeconds(flight.scheduledOut, -(pre + from.groundSeconds));
    if (req.time.mode === 'depart_at' && req.time.instant)
      accessDeparture = maxIso(accessDeparture, req.time.instant);
    accessDeparture = maxIso(accessDeparture, nowIso);

    const fromEndpoint = airportEndpoint(from);
    const toEndpoint = airportEndpoint(to);
    const access = await this.routes.driveLeg(
      req.origin,
      fromEndpoint,
      accessDeparture,
      `Até o aeroporto ${from.iata}`,
      signal,
    );
    if (!access) return null;
    const actualPre = diffSeconds(access.arrival, flight.scheduledOut);
    if (actualPre < 0) return null; // chegaria ao aeroporto depois da partida

    const egressDeparture = addSeconds(flight.scheduledIn, post);
    const egress = await this.routes.driveLeg(
      toEndpoint,
      req.destination,
      egressDeparture,
      `Do aeroporto ${to.iata} ao destino`,
      signal,
    );
    if (!egress) return null;

    const warnings: string[] = [];
    if (actualPre < pre - 60) {
      warnings.push(
        `Com a previsão de trânsito, a chegada ao aeroporto deixa ${formatDuration(actualPre)} antes do voo — menos que a margem de ${formatDuration(pre)} escolhida.`,
      );
    }
    if (access.usedReferencePoint || egress.usedReferencePoint) {
      warnings.push(
        'Não foi possível localizar o terminal pelo nome do aeroporto; o trajeto terrestre usa a coordenada de referência do aeroporto (OurAirports).',
      );
    }
    if (flight.isCodeshare && flight.operatorIdent) {
      warnings.push(`Voo ${flight.ident} operado como ${flight.operatorIdent}.`);
    }

    const fromInfo = toAirportInfo(from);
    const toInfo = toAirportInfo(to);
    const segments: Segment[] = [
      access.segment,
      {
        kind: 'buffer',
        userDefined: true,
        durationSeconds: actualPre,
        label: `No aeroporto antes do voo (margem escolhida: ${formatDuration(pre)})`,
      },
      {
        kind: 'flight',
        durationSeconds: diffSeconds(flight.scheduledOut, flight.scheduledIn),
        flight: {
          ident: flight.ident,
          identIata: flight.identIata,
          operatorIdent: flight.operatorIdent,
          aircraftType: flight.aircraftType,
          scheduledOut: flight.scheduledOut,
          scheduledIn: flight.scheduledIn,
          isCodeshare: flight.isCodeshare,
          provider: this.provider.name,
        },
        from: fromInfo,
        to: toInfo,
        departure: { instant: flight.scheduledOut, timeZone: from.timeZone },
        arrival: { instant: flight.scheduledIn, timeZone: to.timeZone },
      },
      {
        kind: 'buffer',
        userDefined: true,
        durationSeconds: post,
        label: `Após o pouso (margem escolhida: ${formatDuration(post)})`,
      },
      egress.segment,
    ];

    const points = [
      ...decodePolyline(access.segment.polyline),
      ...decodePolyline(egress.segment.polyline),
      from.location,
      to.location,
    ];

    return {
      id: `flight-${index}`,
      mode: 'flight',
      summary: `${from.iata} → ${to.iata} · ${flight.ident}`,
      departure: { instant: access.departure, timeZone: req.origin.timeZone },
      arrival: { instant: egress.arrival, timeZone: req.destination.timeZone },
      durationSeconds: diffSeconds(access.departure, egress.arrival),
      traffic: {
        freshness: 'predicted',
        note: 'Horários de voo publicados pela companhia (programados). Trechos de carro com previsão de trânsito.',
      },
      segments,
      bounds: boundsOf(points),
      warnings,
      isDefault: index === 0,
      scheduleNote:
        'Voo: horários de gate publicados pela companhia (FlightAware AeroAPI), sem garantia de operação. Trechos terrestres: Routes API. Margens antes/depois do voo: definidas por você (não são tempos oficiais).',
    };
  }
}

function airportEndpoint(a: NearbyAirport & { timeZone?: string }): Endpoint {
  return {
    name: `${a.name} (${a.iata})`,
    location: a.location,
    types: ['airport'],
    timeZone: a.timeZone,
    source: 'ourairports',
    addressQuery: [a.name, a.municipality, a.countryCode].filter(Boolean).join(', '),
    expectedType: 'airport',
  };
}

function toAirportInfo(a: NearbyAirport & { timeZone?: string }): AirportInfo {
  return {
    iata: a.iata,
    icao: a.icao,
    name: a.name,
    municipality: a.municipality,
    countryCode: a.countryCode,
    location: a.location,
    timeZone: a.timeZone,
    distanceFromPlaceKm: Math.round(a.distanceKm * 10) / 10,
  };
}

function maxIso(a: string, b: string): string {
  return diffSeconds(a, b) > 0 ? b : a;
}

function methodText(): string {
  return 'Aeroportos com voos regulares próximos (OurAirports) → voos diretos publicados (AeroAPI) → trechos de carro (Routes API). Margens no aeroporto definidas por você.';
}
