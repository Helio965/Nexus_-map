import type { ModeResult, TravelMode } from '@nexus/shared';
import { AppError } from '../lib/errors';
import { NoRouteError } from './RouteService';

const NO_ROUTE: Record<TravelMode, string> = {
  drive: 'Não encontramos uma rota de carro entre esses pontos.',
  walk: 'Não encontramos uma rota a pé entre esses pontos.',
  rail: 'Não há rota de metrô / trilhos disponível para este trajeto.',
  flight: 'Não há rota aérea adequada disponível.',
};

/**
 * Executa um modo e converte falhas em um ModeResult honesto:
 * credencial ausente → not_configured; falha do provedor → error (nunca "sem rota" inventado).
 * Erros de validação continuam como 400.
 */
export async function runMode(
  mode: TravelMode,
  provider: string,
  fn: () => Promise<ModeResult>,
  signal?: AbortSignal,
): Promise<ModeResult> {
  try {
    return await fn();
  } catch (err) {
    if (signal?.aborted) throw err;
    const base = { mode, options: [], warnings: [], provider };
    if (err instanceof NoRouteError)
      return { ...base, status: 'unavailable', message: NO_ROUTE[mode] };
    if (err instanceof AppError) {
      if (err.code === 'VALIDATION') throw err;
      if (err.code === 'NOT_CONFIGURED')
        return { ...base, status: 'not_configured', message: err.message };
      return { ...base, status: 'error', message: err.message };
    }
    console.error(`[${mode}] erro inesperado:`, err);
    return { ...base, status: 'error', message: 'Erro inesperado ao calcular esta opção.' };
  }
}
