import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ApiErrorBody } from '@nexus/shared';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { ZodError } from 'zod';
import type { Env } from './config/env';
import type { Services } from './container';
import { apiRouter } from './http/routes';
import { AppError, isAbortError } from './lib/errors';
import { TokenBucketLimiter } from './lib/throttle';

export interface AppOptions {
  now?: () => Date;
  /** Diretório do build do cliente para servir em produção. */
  clientDist?: string | null;
  rateLimit?: { capacity: number; refillPerSecond: number } | null;
}

export function createApp(
  services: Services,
  env: Pick<Env, 'CORS_ORIGIN' | 'NODE_ENV'>,
  opts: AppOptions = {},
) {
  const app = express();
  app.disable('x-powered-by');

  app.use(
    helmet({
      // CSP compatível com a Maps JavaScript API (allowlist da documentação do Google).
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'script-src': [
            "'self'",
            "'unsafe-inline'",
            "'unsafe-eval'",
            'https://*.googleapis.com',
            'https://*.gstatic.com',
            '*.google.com',
            'https://*.ggpht.com',
            '*.googleusercontent.com',
            'blob:',
          ],
          'img-src': [
            "'self'",
            'https://*.googleapis.com',
            'https://*.gstatic.com',
            '*.google.com',
            '*.googleusercontent.com',
            'data:',
            'blob:',
          ],
          'frame-src': ['*.google.com'],
          'connect-src': [
            "'self'",
            'https://*.googleapis.com',
            '*.google.com',
            'https://*.gstatic.com',
            'data:',
            'blob:',
          ],
          'font-src': ["'self'", 'https://fonts.gstatic.com'],
          'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          'worker-src': ['blob:'],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  if (env.CORS_ORIGIN) {
    const origin = env.CORS_ORIGIN;
    app.use('/api', (req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') return void res.sendStatus(204);
      next();
    });
  }

  app.use(express.json({ limit: '1mb' }));

  if (opts.rateLimit !== null) {
    const limiter = new TokenBucketLimiter(
      opts.rateLimit?.capacity ?? 120,
      opts.rateLimit?.refillPerSecond ?? 2,
    );
    app.use('/api', (req, res, next) => {
      if (req.path === '/signals/stream') return next();
      if (!limiter.take(req.ip ?? 'unknown')) {
        const body: ApiErrorBody = {
          error: { code: 'RATE_LIMITED', message: 'Muitas requisições. Aguarde alguns segundos.' },
        };
        return void res.status(429).json(body);
      }
      next();
    });
  }

  app.use('/api', apiRouter(services, opts.now));
  app.use('/api', (_req, res) => {
    const body: ApiErrorBody = {
      error: { code: 'NOT_FOUND', message: 'Rota da API não encontrada.' },
    };
    res.status(404).json(body);
  });

  const clientDist =
    opts.clientDist === undefined
      ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist')
      : opts.clientDist;
  if (clientDist && existsSync(path.join(clientDist, 'index.html'))) {
    app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    if (isAbortError(err) || req.socket.destroyed) return;
    let body: ApiErrorBody;
    let status: number;
    if (err instanceof ZodError) {
      status = 400;
      const first = err.issues[0];
      body = {
        error: {
          code: 'VALIDATION',
          message:
            first?.message && !first.message.startsWith('Invalid')
              ? first.message
              : 'Requisição inválida.',
          details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      };
    } else if (err instanceof AppError) {
      status = err.status;
      body = { error: { code: err.code, message: err.message } };
    } else if ((err as { type?: string }).type === 'entity.parse.failed') {
      status = 400;
      body = { error: { code: 'VALIDATION', message: 'JSON inválido.' } };
    } else {
      console.error('[api] erro inesperado:', err);
      status = 500;
      body = { error: { code: 'INTERNAL', message: 'Erro interno inesperado.' } };
    }
    res.status(status).json(body);
  });

  return app;
}
