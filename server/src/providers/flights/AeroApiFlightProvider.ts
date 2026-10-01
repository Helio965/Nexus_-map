import { TtlCache, cacheKey } from '../../lib/cache';
import { AppError } from '../../lib/errors';
import { fetchJson, UpstreamHttpError, type FetchFn } from '../../lib/http';
import { SlidingWindowThrottle } from '../../lib/throttle';
import type { DirectFlightQuery, FlightProvider, ScheduledFlight } from './FlightProvider';

export const AEROAPI_NAME = 'FlightAware AeroAPI';

/** Subconjunto de `GET /schedules/{date_start}/{date_end}` (AeroAPI v4, spec OpenAPI oficial). */
export interface RawAeroApiSchedules {
  scheduled?: Array<{
    ident?: string;
    ident_iata?: string | null;
    actual_ident?: string | null;
    actual_ident_iata?: string | null;
    aircraft_type?: string;
    scheduled_out?: string;
    scheduled_in?: string;
    origin_iata?: string | null;
    destination_iata?: string | null;
  }>;
  links?: { next?: string } | null;
  num_pages?: number;
}

export interface AeroApiOptions {
  apiKey: string;
  baseUrl: string;
  maxRequestsPerMinute: number;
  fetchFn?: FetchFn;
  /** Páginas por consulta (cada página = 1 "result set" cobrado). */
  maxPages?: number;
}

/**
 * Horários publicados pelas companhias (até 3 meses no passado e 1 ano no futuro;
 * janela de no máximo 3 semanas por consulta). Somente voos diretos.
 */
export class AeroApiFlightProvider implements FlightProvider {
  readonly id = 'aeroapi';
  readonly name = AEROAPI_NAME;
  readonly configured = true;
  readonly maxWindowMs = 21 * 86_400_000;
  readonly maxFutureMs = 365 * 86_400_000;

  private readonly throttle: SlidingWindowThrottle;
  private readonly cache = new TtlCache<ScheduledFlight[]>(30 * 60_000, 500);
  private readonly fetchFn: FetchFn;

  constructor(private readonly opts: AeroApiOptions) {
    this.throttle = new SlidingWindowThrottle(opts.maxRequestsPerMinute);
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  async searchDirectFlights(
    q: DirectFlightQuery,
    signal?: AbortSignal,
  ): Promise<ScheduledFlight[]> {
    // Janela alargada para horas cheias (início para baixo, fim para cima) para aproveitar o
    // cache entre consultas próximas; o FlightService filtra os voos pela janela exata.
    const start = floorHour(q.departureWindowStart);
    const end = ceilHour(q.departureWindowEnd);
    const key = cacheKey([q.originIata, q.destinationIata, start, end]);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const pages = Math.max(1, this.opts.maxPages ?? 2);
    if (!(await this.throttle.acquire(signal))) {
      throw new AppError(
        'RATE_LIMITED',
        'Limite de consultas de voos por minuto atingido. Tente novamente em instantes.',
        {
          provider: AEROAPI_NAME,
        },
      );
    }
    const qs = new URLSearchParams({
      origin: q.originIata,
      destination: q.destinationIata,
      // Evita repetir o mesmo voo físico sob vários números comerciais.
      include_codeshares: 'false',
      max_pages: String(pages),
    });
    const url = `${this.opts.baseUrl}/schedules/${encodeURIComponent(start)}/${encodeURIComponent(end)}?${qs.toString()}`;
    let raw: RawAeroApiSchedules;
    try {
      raw = await fetchJson<RawAeroApiSchedules>(
        this.fetchFn,
        url,
        { headers: { 'x-apikey': this.opts.apiKey }, signal, timeoutMs: 20_000 },
        AEROAPI_NAME,
      );
    } catch (err) {
      throw mapAeroApiError(err);
    }
    const flights = mapSchedules(raw);
    this.cache.set(key, flights);
    return flights;
  }
}

export function mapSchedules(raw: RawAeroApiSchedules): ScheduledFlight[] {
  const seen = new Set<string>();
  const out: ScheduledFlight[] = [];
  for (const f of raw.scheduled ?? []) {
    if (!f.ident || !f.scheduled_out || !f.scheduled_in || !f.origin_iata || !f.destination_iata)
      continue;
    const operator = f.actual_ident_iata ?? f.actual_ident ?? undefined;
    const ident = f.ident_iata ?? f.ident;
    const dedupe = `${f.origin_iata}|${f.destination_iata}|${f.scheduled_out}|${f.scheduled_in}|${operator ?? ident}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({
      ident,
      identIata: f.ident_iata ?? undefined,
      operatorIdent: operator && operator !== ident ? operator : undefined,
      aircraftType: f.aircraft_type || undefined,
      originIata: f.origin_iata,
      destinationIata: f.destination_iata,
      scheduledOut: f.scheduled_out,
      scheduledIn: f.scheduled_in,
      isCodeshare: !!operator && operator !== ident,
    });
  }
  return out.sort((a, b) => a.scheduledOut.localeCompare(b.scheduledOut));
}

function mapAeroApiError(err: unknown): unknown {
  if (!(err instanceof UpstreamHttpError)) return err;
  const body = (err.body ?? {}) as { title?: string; detail?: string };
  if (err.status === 401 || err.status === 403) {
    return new AppError(
      'UPSTREAM',
      'A chave da AeroAPI foi recusada (verifique FLIGHTAWARE_AEROAPI_KEY e o plano contratado).',
      {
        provider: AEROAPI_NAME,
        details: body.detail,
      },
    );
  }
  if (err.status === 429) {
    return new AppError(
      'RATE_LIMITED',
      'Limite de consultas da AeroAPI atingido. Tente novamente em instantes.',
      {
        provider: AEROAPI_NAME,
      },
    );
  }
  if (err.status === 400) {
    return new AppError(
      'UPSTREAM',
      `A AeroAPI recusou a consulta${body.detail ? `: ${body.detail}` : '.'}`,
      {
        provider: AEROAPI_NAME,
        details: body.detail,
      },
    );
  }
  return new AppError('UPSTREAM', 'A AeroAPI está temporariamente indisponível.', {
    provider: AEROAPI_NAME,
  });
}

function floorHour(iso: string): string {
  const d = new Date(iso);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString().replace('.000Z', 'Z');
}

function ceilHour(iso: string): string {
  const d = new Date(iso);
  if (d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0 || d.getUTCMilliseconds() !== 0) {
    d.setUTCHours(d.getUTCHours() + 1, 0, 0, 0);
  }
  return d.toISOString().replace('.000Z', 'Z');
}
