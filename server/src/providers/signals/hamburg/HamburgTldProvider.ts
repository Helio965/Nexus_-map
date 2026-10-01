import {
  boundsIntersect,
  boundsOf,
  expandBounds,
  projectOntoPath,
  type Bounds,
  type LatLng,
  type SignalApproachState,
  type SignalStateUpdate,
  type TrafficSignalFeature,
} from '@nexus/shared';
import { AppError } from '../../../lib/errors';
import { fetchJson, type FetchFn } from '../../../lib/http';
import type { RouteGeometry, TrafficSignalProvider } from '../TrafficSignalProvider';
import type { HamburgMqttBridge, TldObservation } from './HamburgMqttBridge';
import {
  isMotorVehicleLane,
  matchLaneConnection,
  phaseFromTldCode,
  type LaneConnection,
  type LaneMatch,
} from './laneMatching';

export const HAMBURG_TLD_NAME = 'Hamburg Traffic Lights Data (TLD)';
export const HAMBURG_TLD_ATTRIBUTION =
  'Freie und Hansestadt Hamburg, Landesbetrieb Straßen, Brücken und Gewässer — Traffic Lights Data (beta)';
const PROVIDER_ID = 'hamburg_tld';

/**
 * Pré-filtro: limites aproximados do estado de Hamburgo (continente). Só serve para não
 * consultar a fonte em rotas de outras cidades; a cobertura real é a resposta da própria fonte.
 */
export const HAMBURG_PREFILTER_BOUNDS: Bounds = {
  north: 53.75,
  south: 53.39,
  west: 9.72,
  east: 10.33,
};

interface RawThing {
  '@iot.id': number;
  name?: string;
  properties?: { trafficLightsID?: string; laneType?: string };
  Locations?: Array<{ location?: { geometry?: { type?: string; coordinates?: number[][][] } } }>;
  Datastreams?: Array<{
    '@iot.id': number;
    properties?: { signalGroupID?: string; layerName?: string };
    Observations?: TldObservation[];
  }>;
}

interface RawCollection<T> {
  value?: T[];
  '@iot.nextLink'?: string;
}

export interface HamburgTldOptions {
  baseUrl: string;
  staleAfterSeconds: number;
  fetchFn?: FetchFn;
  bridge?: HamburgMqttBridge;
  now?: () => Date;
  /** Intervalo do polling de contingência quando o MQTT está desconectado. */
  fallbackPollMs?: number;
}

const CHUNK_METERS = 400;
const CORRIDOR_MARGIN_M = 40;
const POLYGONS_PER_REQUEST = 20;
const MAX_PAGES = 5;

/**
 * Telemetria REAL de semáforos de Hamburgo (OGC SensorThings + MQTT).
 * Publica a fase atual por conexão de faixa; NÃO publica tempo restante — por isso
 * `supportsCountdown = false` e nenhuma contagem regressiva é calculada.
 */
export class HamburgTldProvider implements TrafficSignalProvider {
  readonly id = PROVIDER_ID;
  readonly name = HAMBURG_TLD_NAME;
  readonly attribution = HAMBURG_TLD_ATTRIBUTION;
  readonly supportsCountdown = false;

  private readonly fetchFn: FetchFn;
  private readonly now: () => Date;

  constructor(private readonly opts: HamburgTldOptions) {
    this.fetchFn = opts.fetchFn ?? fetch;
    this.now = opts.now ?? (() => new Date());
  }

  appliesTo(route: RouteGeometry): boolean {
    return boundsIntersect(route.bounds, HAMBURG_PREFILTER_BOUNDS);
  }

  async findAlongRoute(
    route: RouteGeometry,
    signal?: AbortSignal,
  ): Promise<TrafficSignalFeature[]> {
    const polygons = corridorPolygons(route.path).filter((b) =>
      boundsIntersect(b, HAMBURG_PREFILTER_BOUNDS),
    );
    const things: RawThing[] = [];
    for (let i = 0; i < polygons.length; i += POLYGONS_PER_REQUEST) {
      things.push(...(await this.queryThings(polygons.slice(i, i + POLYGONS_PER_REQUEST), signal)));
    }
    const connections = things.map(toLaneConnection).filter((c): c is LaneConnection => c !== null);
    return this.buildFeatures(connections, route);
  }

  /** Separado para testes: aplica a associação de sentido e agrupa por cruzamento (LSA). */
  buildFeatures(connections: LaneConnection[], route: RouteGeometry): TrafficSignalFeature[] {
    const matchedByLight = new Map<string, LaneMatch[]>();
    const nearbyUnmatched = new Map<string, LatLng>();
    const seen = new Set<number>();
    for (const conn of connections) {
      if (seen.has(conn.thingId)) continue;
      seen.add(conn.thingId);
      if (!isMotorVehicleLane(conn.laneType)) continue;
      const match = matchLaneConnection(conn, route);
      if (match) {
        const list = matchedByLight.get(conn.trafficLightsId) ?? [];
        list.push(match);
        matchedByLight.set(conn.trafficLightsId, list);
      } else {
        const stop = conn.lines[0]?.[0];
        const p = stop ? projectOntoPath(stop, route.path, route.cumulative) : null;
        if (stop && p && p.lateral <= 15 && !nearbyUnmatched.has(conn.trafficLightsId)) {
          nearbyUnmatched.set(conn.trafficLightsId, stop);
        }
      }
    }

    const features: TrafficSignalFeature[] = [];
    const nowMs = this.now().getTime();
    for (const [lightId, matches] of matchedByLight) {
      matches.sort((a, b) => a.stopAlongMeters - b.stopAlongMeters);
      const approaches: SignalApproachState[] = matches
        .filter((m) => m.connection.datastreamId !== undefined)
        .map((m) => ({
          streamId: `${PROVIDER_ID}:${m.connection.datastreamId}`,
          laneConnection: m.connection.name,
          signalGroup: m.connection.signalGroup,
          laneType: m.connection.laneType,
          travelDirection: m.travelDirection,
          ...this.stateFromObservation(m.connection.latest, nowMs),
        }));
      if (approaches.length === 0) continue;
      features.push({
        id: `${PROVIDER_ID}:${lightId}`,
        location: matches[0]!.stop,
        label: `Semáforo LSA ${lightId} — Hamburgo`,
        distanceAlongRouteMeters: Math.round(matches[0]!.stopAlongMeters),
        sources: [
          {
            provider: HAMBURG_TLD_NAME,
            attribution: HAMBURG_TLD_ATTRIBUTION,
            reference: `trafficLightsID=${lightId}`,
          },
        ],
        telemetry: {
          status: 'live',
          provider: HAMBURG_TLD_NAME,
          approaches,
          supportsCountdown: false,
        },
      });
    }
    for (const [lightId, stop] of nearbyUnmatched) {
      if (matchedByLight.has(lightId)) continue;
      const p = projectOntoPath(stop, route.path, route.cumulative);
      features.push({
        id: `${PROVIDER_ID}:${lightId}`,
        location: stop,
        label: `Semáforo LSA ${lightId} — Hamburgo`,
        distanceAlongRouteMeters: p ? Math.round(p.distanceAlong) : undefined,
        sources: [
          {
            provider: HAMBURG_TLD_NAME,
            attribution: HAMBURG_TLD_ATTRIBUTION,
            reference: `trafficLightsID=${lightId}`,
          },
        ],
        telemetry: {
          status: 'direction_unknown',
          provider: HAMBURG_TLD_NAME,
          reason:
            'Este cruzamento publica telemetria, mas não foi possível associar com segurança uma fase ao seu sentido de deslocamento. Nenhuma fase é exibida.',
        },
      });
    }
    return features.sort(
      (a, b) => (a.distanceAlongRouteMeters ?? 0) - (b.distanceAlongRouteMeters ?? 0),
    );
  }

  async getStates(streamIds: string[], signal?: AbortSignal): Promise<SignalStateUpdate[]> {
    const ids = streamIds.map(localId).filter((n): n is number => n !== null);
    const out: SignalStateUpdate[] = [];
    const nowMs = this.now().getTime();
    for (let i = 0; i < ids.length; i += 40) {
      const chunk = ids.slice(i, i + 40);
      const filter = chunk.map((id) => `id eq ${id}`).join(' or ');
      const qs = new URLSearchParams({
        $filter: filter,
        $select: 'id',
        $expand:
          'Observations($orderby=phenomenonTime desc;$top=1;$select=phenomenonTime,resultTime,result)',
        $top: String(chunk.length),
      });
      const res = await this.get<
        RawCollection<{ '@iot.id': number; Observations?: TldObservation[] }>
      >(`${this.opts.baseUrl}/Datastreams?${qs.toString()}`, signal);
      for (const ds of res.value ?? []) {
        out.push({
          streamId: `${PROVIDER_ID}:${ds['@iot.id']}`,
          ...this.stateFromObservation(ds.Observations?.[0], nowMs),
        });
      }
    }
    return out;
  }

  subscribe(streamIds: string[], onUpdate: (u: SignalStateUpdate) => void): () => void {
    const ids = streamIds.map(localId).filter((n): n is number => n !== null);
    const unsubs: Array<() => void> = [];
    const bridge = this.opts.bridge;
    if (bridge) {
      for (const id of ids) {
        unsubs.push(
          bridge.subscribe(id, (dsId, obs) =>
            onUpdate({
              streamId: `${PROVIDER_ID}:${dsId}`,
              ...this.stateFromObservation(obs, this.now().getTime()),
            }),
          ),
        );
      }
    }
    // Contingência: se o MQTT não estiver conectado, consulta o REST periodicamente.
    const pollMs = this.opts.fallbackPollMs ?? 5_000;
    let polling = false;
    const timer = setInterval(async () => {
      if ((bridge && bridge.connected) || polling) return;
      polling = true;
      try {
        for (const u of await this.getStates(streamIds)) onUpdate(u);
      } catch (err) {
        console.warn('[hamburg-tld] polling falhou:', (err as Error).message);
      } finally {
        polling = false;
      }
    }, pollMs);
    timer.unref?.();
    return () => {
      clearInterval(timer);
      for (const u of unsubs) u();
    };
  }

  private stateFromObservation(
    obs: TldObservation | undefined,
    nowMs: number,
  ): Omit<
    SignalApproachState,
    'streamId' | 'laneConnection' | 'signalGroup' | 'laneType' | 'travelDirection'
  > {
    if (!obs || obs.result === undefined) return { phase: null, stale: false };
    const phase = phaseFromTldCode(obs.result);
    const since = obs.phenomenonTime ? Date.parse(obs.phenomenonTime) : NaN;
    const stale = Number.isFinite(since)
      ? nowMs - since > this.opts.staleAfterSeconds * 1000
      : true;
    return { phase, phaseSince: obs.phenomenonTime, receivedAt: obs.resultTime, stale };
  }

  private async queryThings(polygons: Bounds[], signal?: AbortSignal): Promise<RawThing[]> {
    const spatial = polygons
      .map((b) => `st_intersects(Locations/location,geography'${toWktPolygon(b)}')`)
      .join(' or ');
    const qs = new URLSearchParams({
      $filter: `substringof('KFZ',properties/laneType) and (${spatial})`,
      $select: 'id,name,properties',
      $expand:
        "Locations($select=location),Datastreams($filter=properties/layerName eq 'primary_signal';$select=id,properties;$expand=Observations($orderby=phenomenonTime desc;$top=1;$select=phenomenonTime,resultTime,result))",
      $top: '200',
    });
    let url: string | undefined = `${this.opts.baseUrl}/Things?${qs.toString()}`;
    const out: RawThing[] = [];
    for (let page = 0; url && page < MAX_PAGES; page++) {
      const res: RawCollection<RawThing> = await this.get<RawCollection<RawThing>>(url, signal);
      out.push(...(res.value ?? []));
      url = res['@iot.nextLink'];
    }
    return out;
  }

  private async get<T>(url: string, signal?: AbortSignal): Promise<T> {
    try {
      return await fetchJson<T>(this.fetchFn, url, { signal, timeoutMs: 20_000 }, HAMBURG_TLD_NAME);
    } catch (err) {
      if (err instanceof AppError || signal?.aborted) throw err;
      throw new AppError(
        'UPSTREAM',
        'Telemetria de semáforos de Hamburgo temporariamente indisponível.',
        {
          provider: HAMBURG_TLD_NAME,
          cause: err,
        },
      );
    }
  }
}

function localId(streamId: string): number | null {
  const m = /^hamburg_tld:(\d+)$/.exec(streamId);
  return m ? Number(m[1]) : null;
}

export function toLaneConnection(t: RawThing): LaneConnection | null {
  const geom = t.Locations?.[0]?.location?.geometry;
  if (geom?.type !== 'MultiLineString' || !geom.coordinates) return null;
  const lines = geom.coordinates.map((line) =>
    line.map(([lng, lat]) => ({ lat: lat!, lng: lng! })),
  );
  const ds =
    t.Datastreams?.find((d) => d.properties?.layerName === 'primary_signal') ?? t.Datastreams?.[0];
  return {
    thingId: t['@iot.id'],
    name: t.name ?? String(t['@iot.id']),
    trafficLightsId: t.properties?.trafficLightsID ?? (t.name ?? '').split('_')[0] ?? '?',
    laneType: t.properties?.laneType ?? '',
    signalGroup: ds?.properties?.signalGroupID,
    lines,
    datastreamId: ds?.['@iot.id'],
    latest: ds?.Observations?.[0],
  };
}

/** Divide a rota em trechos de ~400 m e devolve o retângulo (com margem) de cada um. */
export function corridorPolygons(path: LatLng[]): Bounds[] {
  const out: Bounds[] = [];
  let chunk: LatLng[] = [];
  let acc = 0;
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    if (chunk.length > 0) {
      const prev = chunk[chunk.length - 1]!;
      acc += Math.hypot(
        (p.lat - prev.lat) * 111_320,
        (p.lng - prev.lng) * 111_320 * Math.cos((p.lat * Math.PI) / 180),
      );
    }
    chunk.push(p);
    if (acc >= CHUNK_METERS) {
      out.push(expandBounds(boundsOf(chunk)!, CORRIDOR_MARGIN_M));
      chunk = [p];
      acc = 0;
    }
  }
  if (chunk.length > 1 || out.length === 0)
    out.push(expandBounds(boundsOf(chunk)!, CORRIDOR_MARGIN_M));
  return out;
}

function toWktPolygon(b: Bounds): string {
  const f = (n: number) => n.toFixed(6);
  return `POLYGON((${f(b.west)} ${f(b.south)},${f(b.east)} ${f(b.south)},${f(b.east)} ${f(b.north)},${f(b.west)} ${f(b.north)},${f(b.west)} ${f(b.south)}))`;
}
