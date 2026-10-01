import type { DataFreshness } from './types/routes';
import type { SignalPhase } from './types/signals';

/** Rótulos de estado do dado — sempre texto + símbolo, nunca só cor. */
export const FRESHNESS_LABELS: Record<DataFreshness, { symbol: string; text: string }> = {
  live: { symbol: '●', text: 'Ao vivo' },
  predicted: { symbol: '◷', text: 'Previsão' },
  static: { symbol: '○', text: 'Informação do mapa' },
  none: { symbol: '—', text: 'Sem dados' },
};

/** Fase do semáforo com emoji + texto (acessível, não depende de cor). */
export const SIGNAL_PHASE_LABELS: Record<SignalPhase, { emoji: string; text: string }> = {
  red: { emoji: '🔴', text: 'VERMELHO' },
  amber: { emoji: '🟡', text: 'AMARELO' },
  green: { emoji: '🟢', text: 'VERDE' },
  red_amber: { emoji: '🔴🟡', text: 'VERMELHO + AMARELO' },
  amber_flashing: { emoji: '🟡', text: 'AMARELO PISCANTE' },
  green_flashing: { emoji: '🟢', text: 'VERDE PISCANTE' },
  dark: { emoji: '⚫', text: 'APAGADO' },
  unknown: { emoji: '❔', text: 'DESCONHECIDO (informado pelo provedor)' },
};

export const SIGNAL_NO_TELEMETRY_MESSAGE =
  'Semáforo identificado. Estado em tempo real indisponível nesta localização.';
