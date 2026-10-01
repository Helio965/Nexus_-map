import { AppError, isAbortError, isTimeoutError } from './errors';

export class UpstreamHttpError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `Upstream HTTP ${status}`);
    this.name = 'UpstreamHttpError';
    this.status = status;
    this.body = body;
  }
}

export interface FetchJsonOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  /** Corpo já serializado (ex.: form-urlencoded). */
  rawBody?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type FetchFn = typeof fetch;

/**
 * fetch + JSON com timeout e cancelamento combinados.
 * Lança UpstreamHttpError para respostas não-2xx (com o corpo para diagnóstico)
 * e AppError(UPSTREAM_TIMEOUT) quando o tempo limite é atingido.
 */
export async function fetchJson<T>(
  fetchFn: FetchFn,
  url: string,
  {
    method = 'GET',
    headers = {},
    body,
    rawBody,
    timeoutMs = 15_000,
    signal,
  }: FetchJsonOptions = {},
  providerName = 'provedor externo',
): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetchFn(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined),
      signal: combined,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    if (isTimeoutError(err) || timeout.aborted) {
      throw new AppError('UPSTREAM_TIMEOUT', `Tempo esgotado ao consultar ${providerName}.`, {
        provider: providerName,
        cause: err,
      });
    }
    if (isAbortError(err)) throw err;
    throw new AppError('UPSTREAM', `Não foi possível conectar a ${providerName}.`, {
      provider: providerName,
      cause: err,
    });
  }

  const text = await res.text();
  let parsed: unknown = undefined;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text.slice(0, 500);
    }
  }
  if (!res.ok) throw new UpstreamHttpError(res.status, parsed);
  return parsed as T;
}
