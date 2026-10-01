import type { ModeResult, ModeStatus, RouteOption, TravelMode } from '../types/routes';
import { TRAVEL_MODES } from '../types/routes';
import type { ResolvedTimeRequest, TimeMode, TimePoint } from '../types/time';
import { diffSeconds, toInstant } from '../time/zonedTime';

export interface ComparisonEntry {
  mode: TravelMode;
  status: ModeStatus | 'pending' | 'not_requested';
  message?: string;
  /** Melhor opção do modo segundo o critério do tipo de horário. */
  best?: RouteOption;
  /** Somente em "chegar até". */
  meetsDeadline?: boolean;
  /** prazo − chegada (s). Negativo = atraso. */
  slackSeconds?: number;
  /** "Chegar até": a saída necessária já passou. */
  departureInPast?: boolean;
}

export interface ComparisonResult {
  timeMode: TimeMode;
  deadline?: TimePoint;
  entries: ComparisonEntry[];
}

/** Tolerância para considerar "agora" (relógios e latência de rede). */
const NOW_TOLERANCE_S = 60;

const minutes = (s: number) => Math.round(s / 60);

export function arrivalOf(o: RouteOption): string {
  return o.arrival.instant;
}

/**
 * Escolhe a melhor opção de um modo:
 * - "chegar até": entre as que chegam no prazo (e cuja saída ainda não passou), a de menor
 *   duração; empate → sai mais tarde; empate → menos baldeações. Se nenhuma atende, a que chega
 *   mais cedo (para mostrar o quanto falta).
 * - "agora"/"sair às": a que chega mais cedo; empate → menor duração; empate → menos baldeações.
 */
export function selectBestOption(
  options: RouteOption[],
  time: ResolvedTimeRequest,
  now: Date = new Date(),
): RouteOption | undefined {
  if (options.length === 0) return undefined;
  const nowIso = toInstant(now);
  const byArrival = (a: RouteOption, b: RouteOption) =>
    minutes(diffSeconds(arrivalOf(b), arrivalOf(a))) ||
    minutes(a.durationSeconds - b.durationSeconds) ||
    (a.transfers ?? 0) - (b.transfers ?? 0);

  if (time.mode === 'arrive_by' && time.instant) {
    const deadline = time.instant;
    const feasible = options.filter(
      (o) =>
        diffSeconds(arrivalOf(o), deadline) >= 0 &&
        diffSeconds(nowIso, o.departure.instant) >= -NOW_TOLERANCE_S,
    );
    if (feasible.length > 0) {
      return [...feasible].sort(
        (a, b) =>
          minutes(a.durationSeconds - b.durationSeconds) ||
          // diffSeconds(a, b) = b − a: negativo quando "a" sai mais tarde → "a" vem primeiro.
          minutes(diffSeconds(a.departure.instant, b.departure.instant)) ||
          (a.transfers ?? 0) - (b.transfers ?? 0),
      )[0];
    }
  }
  return [...options].sort(byArrival)[0];
}

export function evaluateDeadline(
  option: RouteOption,
  time: ResolvedTimeRequest,
  now: Date = new Date(),
): Pick<ComparisonEntry, 'meetsDeadline' | 'slackSeconds' | 'departureInPast'> {
  if (time.mode !== 'arrive_by' || !time.instant) return {};
  const slackSeconds = diffSeconds(option.arrival.instant, time.instant);
  const departureInPast = diffSeconds(toInstant(now), option.departure.instant) < -NOW_TOLERANCE_S;
  return { slackSeconds, departureInPast, meetsDeadline: slackSeconds >= 0 && !departureInPast };
}

/**
 * Monta a comparação entre os modos. Não inventa nada: modos sem resultado ficam
 * "pending"/"not_requested" e modos sem rota mantêm a mensagem do serviço.
 */
export function compareModes(
  results: Partial<Record<TravelMode, ModeResult | 'pending'>>,
  time: ResolvedTimeRequest,
  deadlineZone?: string,
  now: Date = new Date(),
): ComparisonResult {
  const entries: ComparisonEntry[] = TRAVEL_MODES.map((mode) => {
    const r = results[mode];
    if (r === undefined) return { mode, status: 'not_requested' };
    if (r === 'pending') return { mode, status: 'pending' };
    if (r.status !== 'available' || r.options.length === 0) {
      return { mode, status: r.status === 'available' ? 'unavailable' : r.status, message: r.message };
    }
    const best = selectBestOption(r.options, time, now);
    if (!best) return { mode, status: 'unavailable', message: r.message };
    return { mode, status: 'available', best, ...evaluateDeadline(best, time, now) };
  });
  return {
    timeMode: time.mode,
    deadline:
      time.mode === 'arrive_by' && time.instant
        ? { instant: time.instant, timeZone: deadlineZone ?? time.zone }
        : undefined,
    entries,
  };
}
