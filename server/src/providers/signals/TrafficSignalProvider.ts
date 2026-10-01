import {
  boundsOf,
  cumulativeDistances,
  decodePolyline,
  type Bounds,
  type LatLng,
  type SignalStateUpdate,
  type TrafficSignalFeature,
} from '@nexus/shared';

/** Geometria da rota pré-processada para consultas espaciais. */
export interface RouteGeometry {
  path: LatLng[];
  cumulative: number[];
  lengthMeters: number;
  bounds: Bounds;
}

export function buildRouteGeometry(encoded: string): RouteGeometry | null {
  const path = decodePolyline(encoded);
  if (path.length < 2) return null;
  const cumulative = cumulativeDistances(path);
  return { path, cumulative, lengthMeters: cumulative[cumulative.length - 1]!, bounds: boundsOf(path)! };
}

/**
 * Fonte que apenas LOCALIZA semáforos (sem estado). Ex.: OpenStreetMap.
 * Os marcadores resultantes são sempre cinza, sem cor de fase.
 */
export interface SignalLocationSource {
  readonly id: string;
  readonly name: string;
  readonly attribution: string;
  findAlongRoute(route: RouteGeometry, signal?: AbortSignal): Promise<TrafficSignalFeature[]>;
}

/**
 * Fonte de TELEMETRIA real (SPaT, ITS municipal, V2X, API governamental...).
 * Uma implementação só pode reportar fase/tempo que a própria fonte publica.
 */
export interface TrafficSignalProvider {
  readonly id: string;
  readonly name: string;
  readonly attribution: string;
  /** true somente se a fonte publica o horário da próxima troca de fase. */
  readonly supportsCountdown: boolean;
  /** Pré-filtro geográfico barato (evita consultar a fonte fora da área atendida). */
  appliesTo(route: RouteGeometry): boolean;
  /** Semáforos com telemetria associados ao sentido de deslocamento da rota. */
  findAlongRoute(route: RouteGeometry, signal?: AbortSignal): Promise<TrafficSignalFeature[]>;
  /** Estado atual dos fluxos (ressincronização). */
  getStates(streamIds: string[], signal?: AbortSignal): Promise<SignalStateUpdate[]>;
  /** Atualizações em tempo real; retorna a função para cancelar. */
  subscribe(streamIds: string[], onUpdate: (u: SignalStateUpdate) => void): () => void;
}
