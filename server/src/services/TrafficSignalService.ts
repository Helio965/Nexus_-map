import {
  haversineMeters,
  toInstant,
  type DemoSignalResponse,
  type SignalLayerResponse,
  type SignalProviderReport,
  type SignalStateSnapshot,
  type SignalStateUpdate,
  type TrafficSignalFeature,
} from '@nexus/shared';
import { AppError } from '../lib/errors';
import type { DemoTrafficSignalProvider } from '../providers/signals/demo/DemoTrafficSignalProvider';
import {
  buildRouteGeometry,
  type SignalLocationSource,
  type TrafficSignalProvider,
} from '../providers/signals/TrafficSignalProvider';

export interface TrafficSignalServiceOptions {
  maxRouteKm: number;
  now?: () => Date;
}

/** Um nó do OSM a menos disso de um semáforo com telemetria é tratado como o mesmo cruzamento. */
const MERGE_RADIUS_M = 35;

/**
 * Orquestra as fontes de semáforos:
 * - localização (OSM) → marcador cinza, sem fase;
 * - telemetria real (ex.: Hamburgo) → fase somente quando associada ao sentido da rota;
 * - demonstração → endpoint separado, nunca misturado aqui.
 */
export class TrafficSignalService {
  private readonly now: () => Date;

  constructor(
    private readonly locators: SignalLocationSource[],
    private readonly providers: TrafficSignalProvider[],
    private readonly opts: TrafficSignalServiceOptions,
    private readonly demo?: DemoTrafficSignalProvider,
  ) {
    this.now = opts.now ?? (() => new Date());
  }

  get demoEnabled(): boolean {
    return !!this.demo;
  }

  async alongRoute(encodedPolyline: string, signal?: AbortSignal): Promise<SignalLayerResponse> {
    const serverTime = toInstant(this.now());
    const route = buildRouteGeometry(encodedPolyline);
    if (!route) throw new AppError('VALIDATION', 'Polilinha da rota inválida.');
    if (route.lengthMeters > this.opts.maxRouteKm * 1000) {
      return {
        status: 'route_too_long',
        features: [],
        messages: [
          `A rota tem ${Math.round(route.lengthMeters / 1000)} km; semáforos só são carregados para rotas de até ${this.opts.maxRouteKm} km, para não consultar áreas grandes demais.`,
        ],
        providers: [],
        serverTime,
      };
    }

    const reports: SignalProviderReport[] = [];
    const messages: string[] = [];

    const telemetryResults = await Promise.allSettled(
      this.providers.map(async (p) => {
        if (!p.appliesTo(route)) {
          reports.push({ id: p.id, name: p.name, status: 'not_applicable', attribution: p.attribution });
          return [] as TrafficSignalFeature[];
        }
        const features = await p.findAlongRoute(route, signal);
        reports.push({ id: p.id, name: p.name, status: 'ok', attribution: p.attribution });
        return features;
      }),
    );
    const locatorResults = await Promise.allSettled(
      this.locators.map(async (l) => {
        const features = await l.findAlongRoute(route, signal);
        reports.push({ id: l.id, name: l.name, status: 'ok', attribution: l.attribution });
        return features;
      }),
    );
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');

    const telemetry: TrafficSignalFeature[] = [];
    telemetryResults.forEach((r, i) => {
      const p = this.providers[i]!;
      if (r.status === 'fulfilled') telemetry.push(...r.value);
      else {
        reports.push({ id: p.id, name: p.name, status: 'error', message: errorMessage(r.reason), attribution: p.attribution });
        messages.push(`${p.name}: ${errorMessage(r.reason)}`);
      }
    });
    const located: TrafficSignalFeature[] = [];
    locatorResults.forEach((r, i) => {
      const l = this.locators[i]!;
      if (r.status === 'fulfilled') located.push(...r.value);
      else {
        reports.push({ id: l.id, name: l.name, status: 'error', message: errorMessage(r.reason), attribution: l.attribution });
        messages.push(`${l.name}: ${errorMessage(r.reason)}`);
      }
    });

    const features = mergeFeatures(telemetry, located);
    const anyLive = features.some((f) => f.telemetry.status === 'live');
    if (!anyLive && features.length > 0) {
      messages.push('Nenhuma fonte de telemetria de semáforos está disponível para esta rota. Os semáforos são exibidos sem estado.');
    }
    const allFailed = reports.length > 0 && reports.every((r) => r.status === 'error' || r.status === 'not_applicable');
    return {
      status: allFailed && features.length === 0 && reports.some((r) => r.status === 'error') ? 'unavailable' : 'ok',
      features,
      messages,
      providers: reports,
      serverTime,
    };
  }

  async states(streamIds: string[], signal?: AbortSignal): Promise<SignalStateSnapshot> {
    const states: SignalStateUpdate[] = [];
    for (const [provider, ids] of this.groupByProvider(streamIds)) {
      states.push(...(await provider.getStates(ids, signal)));
    }
    return { states, serverTime: toInstant(this.now()) };
  }

  subscribe(streamIds: string[], onUpdate: (u: SignalStateUpdate) => void): () => void {
    const unsubs = [...this.groupByProvider(streamIds)].map(([p, ids]) => p.subscribe(ids, onUpdate));
    return () => unsubs.forEach((u) => u());
  }

  demoAlongRoute(encodedPolyline: string): DemoSignalResponse {
    if (!this.demo) {
      throw new AppError('NOT_CONFIGURED', 'O modo demonstração de semáforos está desativado neste servidor.');
    }
    const route = buildRouteGeometry(encodedPolyline);
    if (!route) throw new AppError('VALIDATION', 'Polilinha da rota inválida.');
    return this.demo.simulateAlongRoute(route);
  }

  private groupByProvider(streamIds: string[]): Map<TrafficSignalProvider, string[]> {
    const map = new Map<TrafficSignalProvider, string[]>();
    for (const id of streamIds) {
      const prefix = id.split(':')[0];
      const provider = this.providers.find((p) => p.id === prefix);
      if (!provider) continue;
      const list = map.get(provider) ?? [];
      list.push(id);
      map.set(provider, list);
    }
    return map;
  }
}

/** Junta a fonte OSM ao semáforo com telemetria do mesmo cruzamento, sem duplicar marcadores. */
export function mergeFeatures(telemetry: TrafficSignalFeature[], located: TrafficSignalFeature[]): TrafficSignalFeature[] {
  const withTelemetry = telemetry.map((f) => ({ ...f, sources: [...f.sources] }));
  const result: TrafficSignalFeature[] = [...withTelemetry];
  for (const osm of located) {
    const twin = withTelemetry.find((t) => haversineMeters(t.location, osm.location) <= MERGE_RADIUS_M);
    if (twin) twin.sources.push(...osm.sources);
    else result.push(osm);
  }
  return result.sort((a, b) => (a.distanceAlongRouteMeters ?? 0) - (b.distanceAlongRouteMeters ?? 0));
}

function errorMessage(err: unknown): string {
  if (err instanceof AppError) return err.message;
  return 'fonte temporariamente indisponível';
}
