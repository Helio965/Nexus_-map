import type { ApiErrorCode } from '@nexus/shared';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  VALIDATION: 400,
  NOT_FOUND: 404,
  NOT_CONFIGURED: 503,
  UPSTREAM: 502,
  UPSTREAM_TIMEOUT: 504,
  QUOTA: 503,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

/** Erro com mensagem já adequada ao usuário final (pt-BR). */
export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: unknown;
  readonly provider?: string;

  constructor(
    code: ApiErrorCode,
    message: string,
    opts: { details?: unknown; provider?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: opts.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = opts.details;
    this.provider = opts.provider;
  }
}

export function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'AbortError' || (err as { code?: string }).code === 'ABORT_ERR')
  );
}

export function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.name === 'TimeoutError';
}
