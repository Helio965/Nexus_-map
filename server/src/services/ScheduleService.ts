import { addSeconds, diffSeconds, floorToMinute, toInstant } from '@nexus/shared';

export interface DepartureEstimate {
  /** undefined = saída agora */
  departure: string | undefined;
  durationSeconds: number;
}

export interface ArriveBySolution {
  /** Saída a usar na chamada final (UTC, arredondada para baixo ao minuto). */
  departure: string;
  /** false = a saída necessária já passou. */
  feasible: boolean;
  /** Saída que seria necessária (mesmo quando já passou). */
  requiredDeparture: string;
  estimates: DepartureEstimate[];
}

export interface SolveOptions {
  /** Prazo de chegada (UTC). */
  deadline: string;
  now: Date;
  /** Duração prevista (s) saindo no instante informado (undefined = agora). */
  estimate: (departure: string | undefined) => Promise<number>;
  /** Máximo de chamadas de estimativa (inclui a inicial). */
  maxEstimates?: number;
  /** Convergência: diferença máxima entre saídas consecutivas. */
  toleranceSeconds?: number;
}

/**
 * Calcula a saída para chegar até um horário quando o provedor só aceita horário de SAÍDA
 * (a Routes API ignora `arrivalTime` fora do modo TRANSIT).
 *
 * Iteração de ponto fixo: saída₀ = prazo − duração(agora); saídaₖ₊₁ = prazo − duração(saídaₖ),
 * até |saídaₖ₊₁ − saídaₖ| ≤ tolerância ou acabar o orçamento de chamadas.
 * Não inventa durações: cada passo usa uma resposta real do provedor.
 */
export async function solveDepartureForArrival({
  deadline,
  now,
  estimate,
  maxEstimates = 3,
  toleranceSeconds = 60,
}: SolveOptions): Promise<ArriveBySolution> {
  const nowIso = toInstant(now);
  const estimates: DepartureEstimate[] = [];

  const d0 = await estimate(undefined);
  estimates.push({ departure: undefined, durationSeconds: d0 });
  let departure = floorToMinute(addSeconds(deadline, -d0));

  if (diffSeconds(nowIso, departure) < 0) {
    return { departure: nowIso, feasible: false, requiredDeparture: departure, estimates };
  }

  while (estimates.length < maxEstimates) {
    const d = await estimate(departure);
    estimates.push({ departure, durationSeconds: d });
    const next = floorToMinute(addSeconds(deadline, -d));
    const delta = Math.abs(diffSeconds(departure, next));
    departure = next;
    if (diffSeconds(nowIso, departure) < 0) {
      return { departure: nowIso, feasible: false, requiredDeparture: departure, estimates };
    }
    if (delta <= toleranceSeconds) break;
  }
  return { departure, feasible: true, requiredDeparture: departure, estimates };
}
