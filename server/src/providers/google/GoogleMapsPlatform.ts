import { AppError } from '../../lib/errors';
import { fetchJson, UpstreamHttpError, type FetchFn } from '../../lib/http';

interface GoogleRpcErrorBody {
  error?: { code?: number; message?: string; status?: string };
}

/**
 * Acesso server-side às APIs da Google Maps Platform com a chave privada
 * (nunca enviada ao navegador).
 */
export class GoogleMapsPlatform {
  constructor(
    private readonly apiKey: string | undefined,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  get configured(): boolean {
    return !!this.apiKey;
  }

  requireKey(apiName: string): string {
    if (!this.apiKey) {
      throw new AppError(
        'NOT_CONFIGURED',
        `${apiName} não configurada: defina GOOGLE_MAPS_SERVER_KEY no servidor.`,
        { provider: apiName },
      );
    }
    return this.apiKey;
  }

  /** APIs "New" (Routes, Places New): chave e field mask em cabeçalhos. */
  async callWithFieldMask<T>(
    apiName: string,
    url: string,
    opts: { method: 'GET' | 'POST'; body?: unknown; fieldMask: string; signal?: AbortSignal; timeoutMs?: number },
  ): Promise<T> {
    const key = this.requireKey(apiName);
    try {
      return await fetchJson<T>(
        this.fetchFn,
        url,
        {
          method: opts.method,
          body: opts.body,
          signal: opts.signal,
          timeoutMs: opts.timeoutMs ?? 20_000,
          headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': opts.fieldMask },
        },
        apiName,
      );
    } catch (err) {
      throw mapGoogleError(apiName, err);
    }
  }

  /** Web services "clássicos" (Time Zone, Geocoding): chave na query e campo `status`. */
  async callLegacy<T extends { status?: string; error_message?: string; errorMessage?: string }>(
    apiName: string,
    baseUrl: string,
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<T> {
    const key = this.requireKey(apiName);
    const qs = new URLSearchParams({ ...params, key });
    let body: T;
    try {
      body = await fetchJson<T>(this.fetchFn, `${baseUrl}?${qs.toString()}`, { signal, timeoutMs: 10_000 }, apiName);
    } catch (err) {
      throw mapGoogleError(apiName, err);
    }
    const status = body.status;
    if (status === 'OK' || status === 'ZERO_RESULTS') return body;
    const detail = body.error_message ?? body.errorMessage;
    if (status === 'OVER_QUERY_LIMIT' || status === 'OVER_DAILY_LIMIT') {
      throw new AppError('QUOTA', `Cota da ${apiName} excedida.`, { provider: apiName, details: detail });
    }
    if (status === 'REQUEST_DENIED') {
      throw new AppError(
        'UPSTREAM',
        `${apiName} negou a requisição (verifique se a API está habilitada para a chave do servidor).`,
        { provider: apiName, details: detail },
      );
    }
    throw new AppError('UPSTREAM', `${apiName} respondeu com status ${status ?? 'desconhecido'}.`, {
      provider: apiName,
      details: detail,
    });
  }
}

export function mapGoogleError(apiName: string, err: unknown): unknown {
  if (!(err instanceof UpstreamHttpError)) return err;
  const body = (err.body ?? {}) as GoogleRpcErrorBody;
  const message = body.error?.message;
  const rpc = body.error?.status;
  if (err.status === 429 || rpc === 'RESOURCE_EXHAUSTED') {
    return new AppError('QUOTA', `Cota da ${apiName} excedida. Tente novamente mais tarde.`, { provider: apiName, details: message });
  }
  if (err.status === 403 || rpc === 'PERMISSION_DENIED') {
    return new AppError(
      'UPSTREAM',
      `${apiName} negou acesso (verifique se a API está habilitada e se a chave do servidor tem permissão para ela).`,
      { provider: apiName, details: message },
    );
  }
  if (err.status === 401 || rpc === 'UNAUTHENTICATED') {
    return new AppError('UPSTREAM', `Chave do servidor inválida para ${apiName}.`, { provider: apiName, details: message });
  }
  if (err.status === 404 || rpc === 'NOT_FOUND') {
    return new AppError('NOT_FOUND', `${apiName}: recurso não encontrado.`, { provider: apiName, details: message });
  }
  if (err.status >= 400 && err.status < 500) {
    return new AppError('UPSTREAM', `${apiName} recusou a requisição${message ? `: ${message}` : '.'}`, {
      provider: apiName,
      details: message,
    });
  }
  return new AppError('UPSTREAM', `${apiName} está temporariamente indisponível.`, { provider: apiName, details: message });
}
