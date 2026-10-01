import { parseGoogleDuration, type RouteOption } from '@nexus/shared';
import type { RawComputeRoutesResponse, RawRoute } from '../providers/google/routesTypes';

const FALLBACK_REASON: Record<string, string> = {
  SERVER_ERROR: 'erro no servidor do provedor',
  LATENCY_EXCEEDED: 'tempo de cálculo excedido',
};

/**
 * Traduz o que a Routes API informou sobre trânsito em um rótulo honesto:
 * - "Ao vivo" somente para saída agora (a API usa o trânsito atual);
 * - "Previsão" para saídas futuras (a API pondera mais o histórico quanto mais distante);
 * - "Sem dados" quando a API caiu para o modo sem trânsito (fallbackInfo).
 */
export function describeTraffic(
  route: RawRoute,
  ctx: { departsNow: boolean; fallback?: RawComputeRoutesResponse['fallbackInfo'] },
): RouteOption['traffic'] {
  if (ctx.fallback?.routingMode === 'FALLBACK_TRAFFIC_UNAWARE') {
    const reason = ctx.fallback.reason ? FALLBACK_REASON[ctx.fallback.reason] : undefined;
    return {
      freshness: 'none',
      note: `Dados de trânsito temporariamente indisponíveis: a Routes API calculou esta rota sem considerar o trânsito${reason ? ` (${reason})` : ''}.`,
    };
  }
  const duration = parseGoogleDuration(route.duration);
  const staticDuration = parseGoogleDuration(route.staticDuration);
  const delaySeconds =
    duration !== undefined && staticDuration !== undefined ? duration - staticDuration : undefined;
  return ctx.departsNow
    ? {
        freshness: 'live',
        delaySeconds,
        note: 'Considera o trânsito atual informado pela Routes API.',
      }
    : {
        freshness: 'predicted',
        delaySeconds,
        note: 'Previsão para o horário de saída: quanto mais distante de agora, mais a Routes API se baseia em padrões históricos de trânsito.',
      };
}
