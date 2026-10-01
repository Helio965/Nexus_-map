import type { LatLng } from './geo';

/** Fases do sinal principal (mapeadas 1:1 a partir do provedor; nunca inferidas). */
export type SignalPhase =
  | 'red'
  | 'amber'
  | 'green'
  | 'red_amber'
  | 'amber_flashing'
  | 'green_flashing'
  | 'dark'
  | 'unknown';

export interface SignalApproachState {
  /** Identificador do fluxo de dados no provedor, ex.: "hamburg_tld:15". */
  streamId: string;
  /** Conexão de faixa (faixa de entrada → saída) no provedor. */
  laneConnection: string;
  signalGroup?: string;
  laneType?: string;
  /** Sentido de deslocamento calculado da geometria da faixa, ex.: "sentido norte → sul". */
  travelDirection?: string;
  /** null = o provedor ainda não publicou observação para este fluxo. */
  phase: SignalPhase | null;
  /** Momento em que a fase começou segundo o relógio do controlador. */
  phaseSince?: string;
  /** Momento em que o provedor registrou a observação. */
  receivedAt?: string;
  /** Somente quando o provedor informa o horário da próxima troca. */
  nextChangeAt?: string;
  /** Observação mais antiga que o limite configurado. */
  stale: boolean;
}

export type SignalTelemetry =
  | { status: 'none'; reason: string }
  | {
      status: 'live';
      provider: string;
      approaches: SignalApproachState[];
      /** true somente se o provedor publica tempo restante/horário de troca. */
      supportsCountdown: boolean;
    }
  | { status: 'direction_unknown'; provider: string; reason: string };

export interface SignalSourceRef {
  provider: string;
  attribution: string;
  reference?: string;
}

export interface TrafficSignalFeature {
  id: string;
  location: LatLng;
  label: string;
  distanceAlongRouteMeters?: number;
  sources: SignalSourceRef[];
  telemetry: SignalTelemetry;
}

export type SignalProviderStatus = 'ok' | 'error' | 'not_applicable' | 'disabled';

export interface SignalProviderReport {
  id: string;
  name: string;
  status: SignalProviderStatus;
  message?: string;
  attribution?: string;
}

export interface SignalLayerResponse {
  status: 'ok' | 'route_too_long' | 'unavailable';
  features: TrafficSignalFeature[];
  messages: string[];
  providers: SignalProviderReport[];
  /** Relógio do servidor, usado pelo cliente para corrigir diferença de relógio. */
  serverTime: string;
}

export interface SignalStateUpdate {
  streamId: string;
  phase: SignalPhase | null;
  phaseSince?: string;
  receivedAt?: string;
  nextChangeAt?: string;
  stale: boolean;
}

export interface SignalStateSnapshot {
  states: SignalStateUpdate[];
  serverTime: string;
}

/* ---------- MODO DEMONSTRAÇÃO (dados simulados, isolados dos reais) ---------- */

export const DEMO_SIGNAL_BANNER = 'MODO DEMONSTRAÇÃO — dados simulados';

export interface DemoSignalFeature {
  id: string;
  location: LatLng;
  label: string;
  phase: SignalPhase;
  nextChangeAt: string;
  simulated: true;
}

export interface DemoSignalResponse {
  simulated: true;
  banner: typeof DEMO_SIGNAL_BANNER;
  features: DemoSignalFeature[];
  serverTime: string;
}
