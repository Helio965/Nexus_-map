import { diffSeconds, toInstant, type ResolvedTimeRequest, type TravelMode } from '@nexus/shared';
import { TRANSIT_MAX_DAYS_AHEAD } from '../services/TransitService';

const PAST_TOLERANCE_S = 120;
const DAY_S = 86_400;

/**
 * Regras de horário antes de chamar os provedores (mensagens para o usuário).
 * Retorna null quando o horário é aceitável para o modo.
 */
export function validateRequestedTime(
  time: ResolvedTimeRequest,
  mode: TravelMode,
  now: Date,
): string | null {
  if (time.mode === 'now') return null;
  if (!time.instant) return 'Informe data e horário.';
  const nowIso = toInstant(now);
  const ahead = diffSeconds(nowIso, time.instant);
  if (ahead < -PAST_TOLERANCE_S) {
    return time.mode === 'depart_at'
      ? 'O horário de saída escolhido já passou. Escolha um horário futuro ou "Sair agora".'
      : 'O horário de chegada escolhido já passou. Escolha um horário futuro.';
  }
  if (mode === 'rail' && ahead > TRANSIT_MAX_DAYS_AHEAD * DAY_S) {
    return `Horários de transporte público só podem ser consultados até ${TRANSIT_MAX_DAYS_AHEAD} dias à frente (limite da Routes API).`;
  }
  if (mode === 'flight' && ahead > 365 * DAY_S) {
    return 'Horários de voos só podem ser consultados até 1 ano à frente (limite da fonte de voos).';
  }
  return null;
}
