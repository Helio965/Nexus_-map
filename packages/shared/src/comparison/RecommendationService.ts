import type { RouteOption, TravelMode } from '../types/routes';
import { formatDuration, formatTimePoint } from '../time/format';
import { diffSeconds } from '../time/zonedTime';
import type { ComparisonEntry, ComparisonResult } from './RouteComparisonService';
import { MODE_LABELS } from './modeLabels';

export interface Recommendation {
  mode: TravelMode;
  optionId: string;
  title: string;
  /** Cada motivo é derivado de um valor presente nos dados retornados pelos provedores. */
  reasons: string[];
}

export interface RecommendationResult {
  recommendation: Recommendation | null;
  /** Por que não há recomendação (quando null). */
  reason?: string;
}

const minutes = (s: number) => Math.round(s / 60);

interface Candidate {
  entry: ComparisonEntry & { best: RouteOption };
}

function trafficDelay(o: RouteOption): number {
  return o.traffic.delaySeconds ?? 0;
}

/**
 * Critérios, em ordem (todos objetivos):
 * 1. disponibilidade real do modo;
 * 2. atender ao horário-limite ("chegar até");
 * 3. "chegar até": menor duração total; demais: chegada mais cedo;
 * 4. "chegar até": saída mais tarde; demais: menor duração;
 * 5. menos baldeações;
 * 6. menor atraso por trânsito (somente se a API forneceu).
 */
export function recommend(comparison: ComparisonResult): RecommendationResult {
  const available = comparison.entries.filter(
    (e): e is ComparisonEntry & { best: RouteOption } => e.status === 'available' && !!e.best,
  );
  if (available.length === 0) {
    const pending = comparison.entries.some((e) => e.status === 'pending');
    return {
      recommendation: null,
      reason: pending
        ? 'Aguardando os resultados dos modos de transporte.'
        : 'Nenhum modo de transporte retornou uma opção real para este trajeto.',
    };
  }

  const isArriveBy = comparison.timeMode === 'arrive_by' && !!comparison.deadline;
  const candidates: Candidate[] = (isArriveBy ? available.filter((e) => e.meetsDeadline) : available).map(
    (entry) => ({ entry }),
  );

  if (candidates.length === 0 && comparison.deadline) {
    return {
      recommendation: null,
      reason: `Nenhuma opção disponível chega até ${formatTimePoint(comparison.deadline)}.`,
    };
  }

  const sorted = [...candidates].sort((x, y) => {
    const a = x.entry.best;
    const b = y.entry.best;
    if (isArriveBy) {
      return (
        minutes(a.durationSeconds - b.durationSeconds) ||
        minutes(diffSeconds(a.departure.instant, b.departure.instant)) ||
        (a.transfers ?? 0) - (b.transfers ?? 0) ||
        minutes(trafficDelay(a) - trafficDelay(b))
      );
    }
    return (
      minutes(diffSeconds(b.arrival.instant, a.arrival.instant)) ||
      minutes(a.durationSeconds - b.durationSeconds) ||
      (a.transfers ?? 0) - (b.transfers ?? 0) ||
      minutes(trafficDelay(a) - trafficDelay(b))
    );
  });

  const winner = sorted[0]!.entry;
  const runnerUp = sorted[1]?.entry;
  const best = winner.best;
  const reasons: string[] = [];

  if (isArriveBy && comparison.deadline) {
    reasons.push(
      `chega às ${formatTimePoint(best.arrival)}, antes do limite de ${formatTimePoint(comparison.deadline)}`,
    );
    if (runnerUp) {
      const dDur = minutes(runnerUp.best.durationSeconds - best.durationSeconds);
      if (dDur > 0) {
        reasons.push(
          `menor duração estimada entre as opções que atendem ao prazo (${formatDuration(best.durationSeconds)} contra ${formatDuration(runnerUp.best.durationSeconds)} de ${MODE_LABELS[runnerUp.mode]})`,
        );
      } else {
        reasons.push(
          `mesma duração arredondada que ${MODE_LABELS[runnerUp.mode]}, mas permite sair mais tarde (${formatTimePoint(best.departure)})`,
        );
      }
    }
  } else if (runnerUp) {
    const dArr = minutes(diffSeconds(best.arrival.instant, runnerUp.best.arrival.instant));
    if (dArr > 0) {
      reasons.push(
        `chega mais cedo entre as opções disponíveis (${formatTimePoint(best.arrival)} contra ${formatTimePoint(runnerUp.best.arrival)} de ${MODE_LABELS[runnerUp.mode]})`,
      );
    } else {
      reasons.push(
        `chegada equivalente a ${MODE_LABELS[runnerUp.mode]}, com duração de ${formatDuration(best.durationSeconds)}`,
      );
    }
  }

  if (available.length === 1) reasons.push('única opção disponível para este trajeto');

  if (best.transfers !== undefined && winner.mode === 'rail') {
    reasons.push(
      best.transfers === 0
        ? 'sem baldeações'
        : `${best.transfers} baldeaç${best.transfers === 1 ? 'ão' : 'ões'}`,
    );
  }
  if (best.traffic.delaySeconds !== undefined && winner.mode === 'drive') {
    const d = minutes(best.traffic.delaySeconds);
    reasons.push(
      d > 0
        ? `inclui ${d} min de atraso estimado por trânsito (Routes API)`
        : 'sem atraso por trânsito estimado pela Routes API',
    );
  }
  if (winner.mode === 'flight') {
    const buffers = best.segments.filter((s) => s.kind === 'buffer');
    if (buffers.length > 0) {
      reasons.push(
        `considera as margens definidas por você: ${buffers.map((b) => `${b.label} ${formatDuration(b.durationSeconds)}`).join(', ')}`,
      );
    }
  }

  return {
    recommendation: {
      mode: winner.mode,
      optionId: best.id,
      title: MODE_LABELS[winner.mode],
      reasons,
    },
  };
}
