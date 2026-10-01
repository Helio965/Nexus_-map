import { describe, expect, it } from 'vitest';
import { GoogleTransitService, RAIL_VEHICLE_TYPES } from '../src/services/TransitService';
import { busRoute, fakeRoutesClient, railRoute, request } from './fixtures/routes';

const opts = { languageCode: 'pt-BR', regionCode: 'BR' };

describe('GoogleTransitService.rail (metrô / trilhos)', () => {
  it('pede somente modos ferroviários e sem ônibus', async () => {
    const { client, calls } = fakeRoutesClient(() => ({ routes: [railRoute()] }));
    await new GoogleTransitService(client, opts).rail(request({ mode: 'now' }));
    expect(calls[0]!.body.travelMode).toBe('TRANSIT');
    expect(calls[0]!.body.transitPreferences?.allowedTravelModes).toEqual([
      'SUBWAY',
      'TRAIN',
      'LIGHT_RAIL',
      'RAIL',
    ]);
    expect(calls[0]!.body.transitPreferences?.allowedTravelModes).not.toContain('BUS');
  });

  it('usa arrivalTime nativo em "chegar até" e departureTime em "sair às"', async () => {
    const { client, calls } = fakeRoutesClient(() => ({ routes: [railRoute()] }));
    const svc = new GoogleTransitService(client, opts);
    await svc.rail(request({ mode: 'arrive_by', instant: '2026-10-20T12:00:00Z' }));
    await svc.rail(request({ mode: 'depart_at', instant: '2026-10-20T11:00:00Z' }));
    expect(calls[0]!.body.arrivalTime).toBe('2026-10-20T12:00:00Z');
    expect(calls[0]!.body.departureTime).toBeUndefined();
    expect(calls[1]!.body.departureTime).toBe('2026-10-20T11:00:00Z');
  });

  it('monta estação, linha, sentido, paradas, baldeações e horários reais', async () => {
    const { client } = fakeRoutesClient(() => ({ routes: [railRoute()] }));
    const result = await new GoogleTransitService(client, opts).rail(request({ mode: 'now' }));
    expect(result.status).toBe('available');
    const opt = result.options[0]!;
    expect(opt.transfers).toBe(1);
    expect(opt.segments.map((s) => s.kind)).toEqual(['walk', 'transit', 'walk', 'transit', 'walk']);

    const [walk1, metro, transfer, train, walk2] = opt.segments;
    if (metro?.kind !== 'transit' || train?.kind !== 'transit')
      throw new Error('esperava trechos de trilhos');
    expect(metro.departureStop.name).toBe('Estação Alfa');
    expect(metro.arrivalStop.name).toBe('Estação Beta');
    expect(metro.line).toMatchObject({
      shortName: 'M1',
      vehicleType: 'SUBWAY',
      agencies: ['Operadora Sintética'],
    });
    expect(metro.headsign).toBe('Terminal Sintético Sul');
    expect(metro.stopCount).toBe(6);
    expect(metro.headwaySeconds).toBe(600);
    expect(metro.departure).toEqual({
      instant: '2026-10-20T11:07:00Z',
      timeZone: 'America/Sao_Paulo',
    });
    expect(train.line.vehicleType).toBe('HEAVY_RAIL');

    // Caminhada inicial termina no embarque; a de baldeação começa no desembarque anterior.
    expect(walk1?.kind === 'walk' && walk1.departure?.instant).toBe('2026-10-20T11:02:00Z');
    expect(walk1?.kind === 'walk' && walk1.arrival?.instant).toBe('2026-10-20T11:07:00Z');
    expect(transfer?.kind === 'walk' && transfer.departure?.instant).toBe('2026-10-20T11:22:00Z');
    expect(walk2?.kind === 'walk' && walk2.arrival?.instant).toBe('2026-10-20T11:46:00Z');

    expect(opt.departure.instant).toBe('2026-10-20T11:02:00Z');
    expect(opt.arrival.instant).toBe('2026-10-20T11:46:00Z');
    expect(opt.durationSeconds).toBe(44 * 60);
    expect(opt.summary).toBe('M1 → T2');
    expect(opt.traffic.freshness).toBe('predicted');
  });

  it('omite rotas com ônibus e explica quando só há ônibus', async () => {
    const { client } = fakeRoutesClient(() => ({ routes: [busRoute()] }));
    const result = await new GoogleTransitService(client, opts).rail(request({ mode: 'now' }));
    expect(result.status).toBe('unavailable');
    expect(result.options).toEqual([]);
    expect(result.message).toContain('Não há rota de metrô / trilhos disponível');
    expect(result.message).toContain('ônibus');
  });

  it('mantém as rotas ferroviárias e avisa das omitidas', async () => {
    const { client } = fakeRoutesClient(() => ({ routes: [busRoute(), railRoute()] }));
    const result = await new GoogleTransitService(client, opts).rail(request({ mode: 'now' }));
    expect(result.options).toHaveLength(1);
    expect(result.warnings[0]).toContain('omitida');
  });

  it('sem nenhuma rota → "Não há rota de metrô"', async () => {
    const { client } = fakeRoutesClient(() => ({}));
    const result = await new GoogleTransitService(client, opts).rail(request({ mode: 'now' }));
    expect(result.status).toBe('unavailable');
    expect(result.message).toMatch(
      /^Não há rota de metrô \/ trilhos disponível para este trajeto\./,
    );
  });

  it('não classifica ônibus, balsa ou teleférico como trilhos', () => {
    for (const t of [
      'BUS',
      'INTERCITY_BUS',
      'TROLLEYBUS',
      'FERRY',
      'GONDOLA_LIFT',
      'SHARE_TAXI',
      'OTHER',
    ]) {
      expect(RAIL_VEHICLE_TYPES.has(t)).toBe(false);
    }
    for (const t of ['SUBWAY', 'METRO_RAIL', 'HEAVY_RAIL', 'COMMUTER_TRAIN', 'TRAM']) {
      expect(RAIL_VEHICLE_TYPES.has(t)).toBe(true);
    }
  });
});
