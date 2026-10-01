import { decodePolyline } from '@nexus/shared';
import { describe, expect, it } from 'vitest';
import { FIELD_MASKS } from '../src/providers/google/GoogleRoutesClient';
import { mapTolls, mapTrafficIntervals } from '../src/services/mappers/routeMapper';
import { RouteService, WALK_BETA_WARNING } from '../src/services/RouteService';
import { describeTraffic } from '../src/services/TrafficService';
import { DRIVE_PATH, driveRoute, fakeRoutesClient, request } from './fixtures/routes';

const NOW = new Date('2026-10-20T10:00:00Z'); // 07:00 em Brasília
const opts = {
  languageCode: 'pt-BR',
  regionCode: 'BR',
  trafficOnPolyline: true,
  tolls: true,
  now: () => NOW,
};

describe('RouteService.drive', () => {
  it('sair agora: usa trânsito atual, alternativas e extras; não envia departureTime', async () => {
    const { client, calls } = fakeRoutesClient(() => ({
      routes: [
        driveRoute(),
        driveRoute({
          routeLabels: ['DEFAULT_ROUTE_ALTERNATE'],
          duration: '1300s',
          description: 'Via alternativa',
        }),
      ],
    }));
    const result = await new RouteService(client, opts).drive(request({ mode: 'now' }));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      computeAlternativeRoutes: true,
      polylineQuality: 'HIGH_QUALITY',
      extraComputations: ['TRAFFIC_ON_POLYLINE', 'TOLLS'],
      origin: { placeId: 'ChIJ_origin_test_000001' },
    });
    expect(calls[0]!.body.departureTime).toBeUndefined();
    expect(calls[0]!.fieldMask).toBe(FIELD_MASKS.drive);

    expect(result.status).toBe('available');
    expect(result.options).toHaveLength(2);
    const main = result.options[0]!;
    expect(main.durationSeconds).toBe(1080);
    expect(main.staticDurationSeconds).toBe(900);
    expect(main.traffic).toMatchObject({ freshness: 'live', delaySeconds: 180 });
    expect(main.departure.instant).toBe('2026-10-20T10:00:00Z');
    expect(main.arrival.instant).toBe('2026-10-20T10:18:00Z');
    expect(main.tolls).toEqual({
      present: true,
      estimatedPrices: [{ currencyCode: 'BRL', amount: 7.5 }],
    });
    expect(main.summary).toBe('Via Eixo Sintético');
    expect(main.isDefault).toBe(true);
    expect(result.options[1]!.isDefault).toBe(false);

    const seg = main.segments[0]!;
    expect(seg.kind).toBe('drive');
    if (seg.kind !== 'drive') throw new Error();
    expect(seg.steps.map((s) => s.instruction)).toEqual([
      'Siga para o sul na Via Sintética A',
      'Vire à direita na Via Sintética B',
      'Pegue o acesso para a Via Sintética C',
    ]);
    expect(seg.traffic).toEqual([
      { start: 0, end: 2, speed: 'NORMAL' },
      { start: 2, end: 4, speed: 'TRAFFIC_JAM' },
      { start: 4, end: 5, speed: 'SLOW' },
    ]);
    expect(decodePolyline(seg.polyline)).toHaveLength(DRIVE_PATH.length);
  });

  it('sair às: envia departureTime e rotula o trânsito como previsão', async () => {
    const { client, calls } = fakeRoutesClient(() => ({ routes: [driveRoute()] }));
    const result = await new RouteService(client, opts).drive(
      request({ mode: 'depart_at', instant: '2026-10-20T11:00:00Z', zone: 'America/Sao_Paulo' }),
    );
    expect(calls[0]!.body.departureTime).toBe('2026-10-20T11:00:00Z');
    expect(result.options[0]!.traffic.freshness).toBe('predicted');
    expect(result.options[0]!.departure.instant).toBe('2026-10-20T11:00:00Z');
    expect(result.options[0]!.arrival.instant).toBe('2026-10-20T11:18:00Z');
  });

  it('chegar até: não envia arrivalTime (ignorado para DRIVE) e calcula a saída por iteração', async () => {
    // Duração depende do horário de saída: mais trânsito perto das 08:00 locais (11:00Z).
    const durationFor = (dep?: string) => {
      if (!dep) return 1200; // agora
      const h = new Date(dep).getUTCHours() + new Date(dep).getUTCMinutes() / 60;
      return Math.round(1800 + 600 * Math.max(0, 1 - Math.abs(h - 11)));
    };
    const { client, calls } = fakeRoutesClient((body) => ({
      routes: [driveRoute({ duration: `${durationFor(body.departureTime)}s` })],
    }));
    const deadline = '2026-10-20T12:00:00Z'; // chegar até 09:00
    const result = await new RouteService(client, opts).drive(
      request({ mode: 'arrive_by', instant: deadline, zone: 'America/Sao_Paulo' }),
    );

    expect(calls.every((c) => c.body.arrivalTime === undefined)).toBe(true);
    const estimates = calls.filter((c) => c.fieldMask === FIELD_MASKS.durationOnly);
    expect(estimates.length).toBeGreaterThanOrEqual(2);
    expect(estimates.every((c) => c.body.extraComputations === undefined)).toBe(true); // SKU Pro
    const finals = calls.filter((c) => c.fieldMask === FIELD_MASKS.drive);
    expect(finals.length).toBeGreaterThanOrEqual(1);
    expect(result.timing?.apiCalls).toBe(calls.length);

    const opt = result.options[0]!;
    // A chegada exibida vem da resposta final (saída + duração daquela resposta).
    const final = finals[finals.length - 1]!;
    expect(opt.departure.instant).toBe(final.body.departureTime);
    expect(new Date(opt.arrival.instant).getTime()).toBeLessThanOrEqual(
      new Date(deadline).getTime(),
    );
    expect(opt.traffic.freshness).toBe('predicted');
  });

  it('chegar até: quando a saída necessária já passou, mostra saída agora e explica', async () => {
    const { client } = fakeRoutesClient(() => ({ routes: [driveRoute({ duration: '3600s' })] }));
    const result = await new RouteService(client, opts).drive(
      request({ mode: 'arrive_by', instant: '2026-10-20T10:30:00Z', zone: 'America/Sao_Paulo' }),
    );
    const opt = result.options[0]!;
    expect(opt.departure.instant).toBe('2026-10-20T10:00:00Z');
    expect(opt.arrival.instant).toBe('2026-10-20T11:00:00Z');
    expect(opt.scheduleNote).toBe(
      'Para chegar até 07:30 seria necessário sair às 06:30, horário que já passou. Exibindo a saída agora.',
    );
  });

  it('sem rotas → indisponível com mensagem (nunca linha reta)', async () => {
    const { client } = fakeRoutesClient(() => ({}));
    const result = await new RouteService(client, opts).drive(request({ mode: 'now' }));
    expect(result.status).toBe('unavailable');
    expect(result.options).toEqual([]);
    expect(result.message).toBe('Não encontramos uma rota de carro entre esses pontos.');
  });

  it('fallback sem trânsito da API → "Sem dados" de trânsito', async () => {
    const { client } = fakeRoutesClient(() => ({
      routes: [driveRoute()],
      fallbackInfo: { routingMode: 'FALLBACK_TRAFFIC_UNAWARE', reason: 'LATENCY_EXCEEDED' },
    }));
    const result = await new RouteService(client, opts).drive(request({ mode: 'now' }));
    expect(result.options[0]!.traffic.freshness).toBe('none');
    expect(result.options[0]!.traffic.note).toContain('temporariamente indisponíveis');
  });

  it('respeita a configuração que desliga extras Enterprise', async () => {
    const { client, calls } = fakeRoutesClient(() => ({ routes: [driveRoute()] }));
    await new RouteService(client, { ...opts, trafficOnPolyline: false, tolls: false }).drive(
      request({ mode: 'now' }),
    );
    expect(calls[0]!.body.extraComputations).toBeUndefined();
  });
});

describe('RouteService.walk', () => {
  it('calcula rota de pedestre própria (WALK) e sempre exibe o aviso de beta', async () => {
    const { client, calls } = fakeRoutesClient(() => ({
      routes: [
        driveRoute({
          duration: '5400s',
          staticDuration: '5400s',
          warnings: ['Aviso da API sintético'],
          travelAdvisory: {},
        }),
      ],
    }));
    const result = await new RouteService(client, opts).walk(request({ mode: 'now' }));
    expect(calls[0]!.body.travelMode).toBe('WALK');
    expect(calls[0]!.body.routingPreference).toBeUndefined();
    expect(result.warnings).toContain(WALK_BETA_WARNING);
    expect(result.options[0]!.warnings).toEqual([WALK_BETA_WARNING, 'Aviso da API sintético']);
    expect(result.options[0]!.traffic.freshness).toBe('static');
    const seg = result.options[0]!.segments[0]!;
    expect(seg.kind === 'walk' && seg.traffic).toBeFalsy();
  });

  it('chegar até: saída = prazo − duração da caminhada', async () => {
    const { client } = fakeRoutesClient(() => ({
      routes: [driveRoute({ duration: '4620s', travelAdvisory: {} })],
    }));
    const result = await new RouteService(client, opts).walk(
      request({ mode: 'arrive_by', instant: '2026-10-20T12:00:00Z', zone: 'America/Sao_Paulo' }),
    );
    expect(result.options[0]!.departure.instant).toBe('2026-10-20T10:43:00Z');
    expect(result.options[0]!.arrival.instant).toBe('2026-10-20T12:00:00Z');
  });
});

describe('mapeadores', () => {
  it('descarta intervalos de trânsito inválidos em vez de corrigi-los', () => {
    expect(
      mapTrafficIntervals(
        [{ startPolylinePointIndex: 3, endPolylinePointIndex: 3, speed: 'SLOW' }],
        10,
      ),
    ).toBeUndefined();
    expect(
      mapTrafficIntervals([{ endPolylinePointIndex: 2, speed: 'SPEED_UNSPECIFIED' }], 10),
    ).toBeUndefined();
    expect(mapTrafficIntervals(undefined, 10)).toBeUndefined();
  });

  it('segue a semântica oficial de TollInfo', () => {
    expect(mapTolls(driveRoute({ travelAdvisory: {} }), true)).toEqual({
      present: false,
      estimatedPrices: [],
    });
    expect(mapTolls(driveRoute({ travelAdvisory: { tollInfo: {} } }), true)).toEqual({
      present: true,
      estimatedPrices: [],
    });
    expect(mapTolls(driveRoute(), false)).toBeUndefined();
  });

  it('só chama de "Ao vivo" quando a saída é agora', () => {
    expect(describeTraffic(driveRoute(), { departsNow: true }).freshness).toBe('live');
    expect(describeTraffic(driveRoute(), { departsNow: false }).freshness).toBe('predicted');
  });
});
