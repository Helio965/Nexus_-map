import {
  SIGNAL_NO_TELEMETRY_MESSAGE,
  projectOntoPath,
  simplifyPath,
  type LatLng,
  type TrafficSignalFeature,
} from '@nexus/shared';
import { TtlCache, cacheKey } from '../../lib/cache';
import { AppError } from '../../lib/errors';
import { fetchJson, UpstreamHttpError, type FetchFn } from '../../lib/http';
import type { RouteGeometry, SignalLocationSource } from './TrafficSignalProvider';

export const OSM_ATTRIBUTION = '© Colaboradores do OpenStreetMap (ODbL)';
const OVERPASS_NAME = 'OpenStreetMap (Overpass API)';

interface OverpassResponse {
  elements?: Array<{ type: string; id: number; lat?: number; lon?: number; tags?: Record<string, string> }>;
  remark?: string;
}

/** Distância máxima (m) entre o nó do semáforo e a rota para considerá-lo "na rota". */
const MAX_LATERAL_M = 20;
const MAX_QUERY_POINTS = 300;

/**
 * Localiza nós `highway=traffic_signals` do OpenStreetMap ao longo da rota.
 * Não há estado em tempo real no OSM: todos os marcadores são "sem telemetria".
 */
export class OsmTrafficSignalLocator implements SignalLocationSource {
  readonly id = 'osm';
  readonly name = OVERPASS_NAME;
  readonly attribution = OSM_ATTRIBUTION;
  // Localização de semáforos muda raramente; o cache reduz a carga na instância pública.
  private readonly cache = new TtlCache<TrafficSignalFeature[]>(6 * 3_600_000, 200);

  constructor(
    private readonly overpassUrl: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async findAlongRoute(route: RouteGeometry, signal?: AbortSignal): Promise<TrafficSignalFeature[]> {
    const line = simplifyForQuery(route.path);
    const key = cacheKey(line.map((p) => [p.lat.toFixed(5), p.lng.toFixed(5)]));
    const cached = this.cache.get(key);
    if (cached) return cached;

    const coords = line.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join(',');
    const query = `[out:json][timeout:25];node["highway"="traffic_signals"](around:${MAX_LATERAL_M},${coords});out body;`;
    let res: OverpassResponse;
    try {
      res = await fetchJson<OverpassResponse>(
        this.fetchFn,
        this.overpassUrl,
        {
          method: 'POST',
          rawBody: new URLSearchParams({ data: query }).toString(),
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'NexusMap/0.1 (planejador de rotas; semáforos ao longo da rota)',
          },
          timeoutMs: 30_000,
          signal,
        },
        OVERPASS_NAME,
      );
    } catch (err) {
      if (err instanceof UpstreamHttpError) {
        throw new AppError(
          err.status === 429 ? 'RATE_LIMITED' : 'UPSTREAM',
          err.status === 429
            ? 'A instância pública do Overpass limitou as consultas. Tente novamente em instantes.'
            : 'OpenStreetMap (Overpass) temporariamente indisponível.',
          { provider: OVERPASS_NAME },
        );
      }
      throw err;
    }
    if (res.remark && /error/i.test(res.remark)) {
      throw new AppError('UPSTREAM', 'OpenStreetMap (Overpass) não concluiu a consulta.', {
        provider: OVERPASS_NAME,
        details: res.remark,
      });
    }

    const features = mapOverpassSignals(res, route);
    this.cache.set(key, features);
    return features;
  }
}

export function mapOverpassSignals(res: OverpassResponse, route: RouteGeometry): TrafficSignalFeature[] {
  const out: TrafficSignalFeature[] = [];
  for (const el of res.elements ?? []) {
    if (el.type !== 'node' || el.lat === undefined || el.lon === undefined) continue;
    if (el.tags?.highway !== 'traffic_signals') continue;
    const location = { lat: el.lat, lng: el.lon };
    const proj = projectOntoPath(location, route.path, route.cumulative);
    if (!proj || proj.lateral > MAX_LATERAL_M + 5) continue;
    out.push({
      id: `osm:node/${el.id}`,
      location,
      label: 'Semáforo (OpenStreetMap)',
      distanceAlongRouteMeters: Math.round(proj.distanceAlong),
      sources: [{ provider: OVERPASS_NAME, attribution: OSM_ATTRIBUTION, reference: `https://www.openstreetmap.org/node/${el.id}` }],
      telemetry: { status: 'none', reason: SIGNAL_NO_TELEMETRY_MESSAGE },
    });
  }
  return out.sort((a, b) => (a.distanceAlongRouteMeters ?? 0) - (b.distanceAlongRouteMeters ?? 0));
}

function simplifyForQuery(path: LatLng[]): LatLng[] {
  let tol = 5;
  let line = simplifyPath(path, tol);
  while (line.length > MAX_QUERY_POINTS && tol < 200) {
    tol *= 2;
    line = simplifyPath(path, tol);
  }
  return line;
}
