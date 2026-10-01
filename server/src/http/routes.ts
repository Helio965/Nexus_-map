import { toInstant, type ModeResult, type RouteRequest, type TravelMode } from '@nexus/shared';
import { Router, type Request, type Response } from 'express';
import type { Services } from '../container';
import { AppError } from '../lib/errors';
import { runMode } from '../services/ModeRunner';
import { ROUTES_PROVIDER } from '../services/RouteService';
import {
  autocompleteQuerySchema,
  flightRequestSchema,
  polylineRequestSchema,
  reverseQuerySchema,
  routeRequestSchema,
  streamIdsSchema,
} from './schemas';
import { validateRequestedTime } from './timeValidation';

/** AbortSignal que dispara quando o cliente desiste da requisição (ex.: nova busca). */
function clientSignal(_req: Request, res: Response): AbortSignal {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished)
      controller.abort(new DOMException('Client closed request', 'AbortError'));
  });
  return controller.signal;
}

export function apiRouter(services: Services, now: () => Date = () => new Date()): Router {
  const r = Router();

  r.get('/health', (_req, res) => {
    res.json({ ok: true, time: toInstant(now()) });
  });

  r.get('/capabilities', (_req, res) => {
    res.json(services.capabilities);
  });

  /* ------------------------------------------------------------ lugares */

  r.get('/places/autocomplete', async (req, res) => {
    const q = autocompleteQuerySchema.parse(req.query);
    const bias =
      q.lat !== undefined && q.lng !== undefined ? { lat: q.lat, lng: q.lng } : undefined;
    const suggestions = await services.places.autocomplete(
      q.q,
      { sessionToken: q.session, bias },
      clientSignal(req, res),
    );
    res.json({ suggestions });
  });

  r.get('/places/details/:placeId', async (req, res) => {
    const placeId = String(req.params.placeId ?? '');
    if (!/^[A-Za-z0-9_-]{10,512}$/.test(placeId))
      throw new AppError('VALIDATION', 'Place ID inválido.');
    const session =
      typeof req.query.session === 'string' ? req.query.session.slice(0, 100) : undefined;
    res.json(await services.places.details(placeId, session, clientSignal(req, res)));
  });

  r.get('/places/reverse', async (req, res) => {
    const q = reverseQuerySchema.parse(req.query);
    res.json(await services.places.reverse({ lat: q.lat, lng: q.lng }, clientSignal(req, res)));
  });

  /* -------------------------------------------------------------- rotas */

  const modeHandler =
    (
      mode: Exclude<TravelMode, 'flight'>,
      run: (body: RouteRequest, signal: AbortSignal) => Promise<ModeResult>,
    ) =>
    async (req: Request, res: Response) => {
      const body = routeRequestSchema.parse(req.body) as RouteRequest;
      const problem = validateRequestedTime(body.time, mode, now());
      if (problem) throw new AppError('VALIDATION', problem);
      const signal = clientSignal(req, res);
      res.json(await runMode(mode, ROUTES_PROVIDER, () => run(body, signal), signal));
    };

  r.post(
    '/routes/drive',
    modeHandler('drive', (b, s) => services.routes.drive(b, s)),
  );
  r.post(
    '/routes/walk',
    modeHandler('walk', (b, s) => services.routes.walk(b, s)),
  );
  r.post(
    '/routes/rail',
    modeHandler('rail', (b, s) => services.transit.rail(b, s)),
  );

  r.post('/routes/flight', async (req, res) => {
    const body = flightRequestSchema.parse(req.body);
    const problem = validateRequestedTime(body.time, 'flight', now());
    if (problem) throw new AppError('VALIDATION', problem);
    const signal = clientSignal(req, res);
    res.json(
      await runMode(
        'flight',
        services.flights.providerName,
        () => services.flights.flight(body, signal),
        signal,
      ),
    );
  });

  /* ---------------------------------------------------------- semáforos */

  r.post('/signals/route', async (req, res) => {
    const { polyline } = polylineRequestSchema.parse(req.body);
    res.json(await services.signals.alongRoute(polyline, clientSignal(req, res)));
  });

  r.get('/signals/state', async (req, res) => {
    const streams = streamIdsSchema.parse(req.query.streams ?? '');
    res.json(await services.signals.states(streams, clientSignal(req, res)));
  });

  /**
   * Server-Sent Events: o servidor assina a fonte (MQTT) somente para os fluxos pedidos e
   * repassa cada observação. Unidirecional e com reconexão automática no EventSource.
   */
  r.get('/signals/stream', (req, res) => {
    const streams = streamIdsSchema.parse(req.query.streams ?? '');
    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    const send = (event: string, data: unknown) =>
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send('hello', { serverTime: toInstant(now()), streams: streams.length });
    const unsubscribe = services.signals.subscribe(streams, (u) => send('state', u));
    const heartbeat = setInterval(() => send('ping', { serverTime: toInstant(now()) }), 15_000);
    res.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  r.post('/signals/demo', (req, res) => {
    const { polyline } = polylineRequestSchema.parse(req.body);
    res.json(services.signals.demoAlongRoute(polyline));
  });

  return r;
}
