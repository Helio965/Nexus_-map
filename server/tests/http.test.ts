import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { parseEnv } from '../src/config/env';
import { createServices } from '../src/container';
import { mapGoogleError } from '../src/providers/google/GoogleMapsPlatform';
import { UpstreamHttpError } from '../src/lib/http';
import { DESTINATION, ORIGIN } from './fixtures/routes';

const NOW = new Date('2026-10-20T10:00:00Z');

/** fetch falso: devolve o status/corpo configurado para qualquer URL (registra as URLs). */
function fakeFetch(status: number, body: unknown) {
  const urls: string[] = [];
  const fn = (async (url: string) => {
    urls.push(String(url));
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fn, urls };
}

function appWith(
  envOverrides: Record<string, string>,
  fetchFn: typeof fetch = fakeFetch(500, {}).fn,
) {
  const env = parseEnv({
    SIGNALS_HAMBURG_TLD_ENABLED: 'false',
    SIGNALS_OSM_ENABLED: 'false',
    ...envOverrides,
  });
  const services = createServices(env, fetchFn);
  return createApp(services, env, { now: () => NOW, clientDist: null, rateLimit: null });
}

const routeBody = { origin: ORIGIN, destination: DESTINATION, time: { mode: 'now' } };

describe('API HTTP', () => {
  it('capabilities não expõe segredos', async () => {
    const res = await request(appWith({ GOOGLE_MAPS_SERVER_KEY: 'segredo-123' })).get(
      '/api/capabilities',
    );
    expect(res.status).toBe(200);
    expect(res.body.google.serverKeyConfigured).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('segredo-123');
  });

  it('sem chave: modos respondem not_configured, sem inventar rota', async () => {
    const app = appWith({});
    for (const mode of ['drive', 'walk', 'rail']) {
      const res = await request(app).post(`/api/routes/${mode}`).send(routeBody);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ mode, status: 'not_configured', options: [] });
    }
    const flight = await request(app)
      .post('/api/routes/flight')
      .send({ ...routeBody, preDepartureMarginMinutes: 90, postArrivalMarginMinutes: 30 });
    expect(flight.body).toMatchObject({ status: 'not_configured', options: [] });
  });

  it('valida origem e destino', async () => {
    const app = appWith({});
    const same = await request(app)
      .post('/api/routes/drive')
      .send({ ...routeBody, destination: ORIGIN });
    expect(same.status).toBe(400);
    expect(same.body.error).toMatchObject({
      code: 'VALIDATION',
      message: 'Origem e destino são o mesmo local.',
    });

    const missing = await request(app)
      .post('/api/routes/drive')
      .send({ origin: ORIGIN, time: { mode: 'now' } });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('VALIDATION');

    const badCoord = await request(app)
      .post('/api/routes/drive')
      .send({ ...routeBody, origin: { ...ORIGIN, location: { lat: 123, lng: 0 } } });
    expect(badCoord.status).toBe(400);
  });

  it('valida horário (obrigatório, no passado)', async () => {
    const app = appWith({});
    const noInstant = await request(app)
      .post('/api/routes/drive')
      .send({ ...routeBody, time: { mode: 'depart_at' } });
    expect(noInstant.status).toBe(400);
    expect(noInstant.body.error.message).toBe(
      'Informe data e horário para "Sair às" ou "Chegar até".',
    );

    const past = await request(app)
      .post('/api/routes/walk')
      .send({ ...routeBody, time: { mode: 'depart_at', instant: '2026-10-20T08:00:00Z' } });
    expect(past.status).toBe(400);
    expect(past.body.error.message).toContain('já passou');
  });

  it('erro da Routes API vira status "error" do modo (não "sem rota")', async () => {
    const { fn, urls } = fakeFetch(403, {
      error: { code: 403, status: 'PERMISSION_DENIED', message: 'API not enabled' },
    });
    const res = await request(appWith({ GOOGLE_MAPS_SERVER_KEY: 'k' }, fn))
      .post('/api/routes/drive')
      .send(routeBody);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('error');
    expect(res.body.message).toContain('negou acesso');
    expect(urls[0]).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
  });

  it('cota excedida → mensagem de cota', async () => {
    const { fn } = fakeFetch(429, { error: { status: 'RESOURCE_EXHAUSTED' } });
    const res = await request(appWith({ GOOGLE_MAPS_SERVER_KEY: 'k' }, fn))
      .post('/api/routes/rail')
      .send(routeBody);
    expect(res.body.status).toBe('error');
    expect(res.body.message).toContain('Cota da Routes API excedida');
  });

  it('autocomplete sem chave → 503 NOT_CONFIGURED', async () => {
    const res = await request(appWith({})).get('/api/places/autocomplete').query({ q: 'Brasília' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('NOT_CONFIGURED');
  });

  it('place details: Place ID inválido é recusado', async () => {
    const res = await request(appWith({ GOOGLE_MAPS_SERVER_KEY: 'k' })).get(
      '/api/places/details/..%2F..%2Fetc',
    );
    expect(res.status).toBe(400);
  });

  it('endereço não encontrado → mensagem clara', async () => {
    const { fn } = fakeFetch(200, { id: 'x' }); // sem location
    const res = await request(appWith({ GOOGLE_MAPS_SERVER_KEY: 'k' }, fn)).get(
      '/api/places/details/ChIJabcdefghij',
    );
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('Não foi possível localizar esse endereço.');
  });

  it('modo demonstração de semáforos fica desligado por padrão', async () => {
    const res = await request(appWith({}))
      .post('/api/signals/demo')
      .send({ polyline: '_p~iF~ps|U_ulLnnqC' });
    expect(res.status).toBe(503);
    expect(res.body.error.message).toContain('desativado');
  });

  it('IDs de fluxo de semáforo são validados', async () => {
    const res = await request(appWith({})).get('/api/signals/state').query({ streams: 'x;drop' });
    expect(res.status).toBe(400);
  });

  it('rota inexistente da API → 404 JSON', async () => {
    const res = await request(appWith({})).get('/api/nao-existe');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('mapeamento de erros da Google', () => {
  it('traduz códigos RPC', () => {
    expect(mapGoogleError('X', new UpstreamHttpError(429, {}))).toMatchObject({ code: 'QUOTA' });
    expect(
      mapGoogleError('X', new UpstreamHttpError(400, { error: { message: 'bad' } })),
    ).toMatchObject({
      code: 'UPSTREAM',
      message: 'X recusou a requisição: bad',
    });
    expect(mapGoogleError('X', new UpstreamHttpError(503, {}))).toMatchObject({
      message: 'X está temporariamente indisponível.',
    });
  });
});
