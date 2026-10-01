import { encodePolyline, type ModeResult, type PlaceSummary, type RouteOption } from '@nexus/shared';
import { describe, expect, it } from 'vitest';
import { drivePolylineForSignals, linesForOption, splitByTraffic, stationsOf, trafficSummary } from '../src/services/MapService';
import { initialPlannerState, plannerReducer } from '../src/state/plannerReducer';
import { defaultDateTime, resolveTimeSelection } from '../src/state/timeResolution';

const SP: PlaceSummary = {
  id: 'ChIJ_test_sp_0000000001',
  name: 'Origem SP (teste)',
  location: { lat: -23.56, lng: -46.65 },
  types: [],
  timeZone: 'America/Sao_Paulo',
  source: 'google_places',
};
const LISBOA: PlaceSummary = {
  id: 'ChIJ_test_lisboa_000001',
  name: 'Destino Lisboa (teste)',
  location: { lat: 38.72, lng: -9.14 },
  types: [],
  timeZone: 'Europe/Lisbon',
  source: 'google_places',
};

describe('resolveTimeSelection (fusos)', () => {
  it('"Sair às" usa o fuso da origem; "Chegar até" usa o fuso do destino', () => {
    const dep = resolveTimeSelection({ mode: 'depart_at', date: '2026-10-20', time: '08:00' }, SP, LISBOA, 'UTC');
    expect(dep).toEqual({ ok: true, resolved: { mode: 'depart_at', instant: '2026-10-20T11:00:00Z', zone: 'America/Sao_Paulo' }, note: undefined });
    const arr = resolveTimeSelection({ mode: 'arrive_by', date: '2026-10-20', time: '08:00' }, SP, LISBOA, 'UTC');
    // Lisboa em outubro (até 25/10) está em WEST = UTC+1.
    expect(arr.ok && arr.resolved.instant).toBe('2026-10-20T07:00:00Z');
  });

  it('localização do dispositivo sem fuso usa o fuso do dispositivo e avisa', () => {
    const device: PlaceSummary = { ...SP, id: undefined, timeZone: undefined, source: 'device_geolocation' };
    const r = resolveTimeSelection({ mode: 'depart_at', date: '2026-10-20', time: '08:00' }, device, LISBOA, 'America/Sao_Paulo');
    expect(r.ok && r.note).toContain('dispositivo');
  });

  it('local sem fuso conhecido → erro, sem chutar fuso', () => {
    const noZone = { ...LISBOA, timeZone: undefined };
    const r = resolveTimeSelection({ mode: 'arrive_by', date: '2026-10-20', time: '08:00' }, SP, noZone, 'America/Sao_Paulo');
    expect(r).toEqual({ ok: false, message: expect.stringContaining('fuso horário do destino') });
  });

  it('recusa horário inexistente (lacuna do horário de verão)', () => {
    const ny = { ...LISBOA, timeZone: 'America/New_York' };
    const r = resolveTimeSelection({ mode: 'arrive_by', date: '2026-03-08', time: '02:30' }, SP, ny, 'UTC');
    expect(r.ok).toBe(false);
  });

  it('exige data e horário', () => {
    expect(resolveTimeSelection({ mode: 'depart_at' }, SP, LISBOA, 'UTC')).toEqual({ ok: false, message: 'Informe a data e o horário.' });
  });

  it('pré-preenche o próximo horário múltiplo de 15 min no fuso pedido', () => {
    expect(defaultDateTime(new Date('2026-10-20T11:07:00Z'), 'America/Sao_Paulo')).toEqual({ date: '2026-10-20', time: '08:15' });
  });
});

describe('plannerReducer', () => {
  const base = initialPlannerState({ mode: 'now' });
  const run = { id: 7, resolved: { mode: 'now' as const }, requested: ['drive' as const, 'walk' as const], origin: SP, destination: LISBOA };
  const result: ModeResult = { mode: 'drive', status: 'unavailable', options: [], warnings: [], provider: 't', message: 'x' };

  it('marca modos como pendentes ao iniciar e ignora respostas de cálculos antigos', () => {
    let s = plannerReducer(base, { type: 'start', run });
    expect(s.results).toEqual({ drive: 'pending', walk: 'pending' });
    s = plannerReducer(s, { type: 'result', runId: 6, result });
    expect(s.results.drive).toBe('pending');
    s = plannerReducer(s, { type: 'result', runId: 7, result });
    expect(s.results.drive).toEqual(result);
  });

  it('trocar origem/destino limpa resultados (não mostra rota de outro trajeto)', () => {
    let s = plannerReducer(base, { type: 'start', run });
    s = plannerReducer(s, { type: 'originText', text: 'outra' });
    expect(s.run).toBeNull();
    expect(s.results).toEqual({});
    expect(s.origin.place).toBeNull();
  });

  it('inverter troca origem e destino', () => {
    let s = plannerReducer(base, { type: 'originPlace', place: SP });
    s = plannerReducer(s, { type: 'destinationPlace', place: LISBOA });
    s = plannerReducer(s, { type: 'swap' });
    expect(s.origin.place?.id).toBe(LISBOA.id);
    expect(s.destination.place?.id).toBe(SP.id);
  });

  it('mudar o horário depois do cálculo marca resultados como desatualizados', () => {
    let s = plannerReducer(base, { type: 'start', run });
    s = plannerReducer(s, { type: 'time', time: { mode: 'arrive_by', date: '2026-10-20', time: '09:00' } });
    expect(s.stale).toBe(true);
  });
});

/* -------------------------------------------------------------- MapService */

const PATH = [
  { lat: 0, lng: 0 },
  { lat: 0, lng: 0.001 },
  { lat: 0, lng: 0.002 },
  { lat: 0, lng: 0.003 },
  { lat: 0, lng: 0.004 },
];

function driveOption(): RouteOption {
  return {
    id: 'drive-0',
    mode: 'drive',
    departure: { instant: '2026-10-20T11:00:00Z' },
    arrival: { instant: '2026-10-20T11:20:00Z' },
    durationSeconds: 1200,
    traffic: { freshness: 'live' },
    warnings: [],
    segments: [
      {
        kind: 'drive',
        polyline: encodePolyline(PATH),
        distanceMeters: 445,
        durationSeconds: 1200,
        steps: [],
        traffic: [
          { start: 1, end: 2, speed: 'SLOW' },
          { start: 2, end: 3, speed: 'TRAFFIC_JAM' },
        ],
      },
    ],
  };
}

describe('MapService', () => {
  it('divide a polilinha nos intervalos de trânsito sem perder trechos', () => {
    const parts = splitByTraffic(PATH, [
      { start: 1, end: 2, speed: 'SLOW' },
      { start: 2, end: 3, speed: 'TRAFFIC_JAM' },
    ]);
    expect(parts.map((p) => [p.speed ?? 'base', p.path.length])).toEqual([
      ['base', 2],
      ['SLOW', 2],
      ['TRAFFIC_JAM', 2],
      ['base', 2],
    ]);
    expect(splitByTraffic(PATH, undefined)).toEqual([{ path: PATH }]);
  });

  it('colore a rota ativa por trânsito e a alternativa em cinza', () => {
    const active = linesForOption(driveOption(), true);
    expect(active.map((l) => l.label)).toEqual([undefined, 'Trânsito lento', 'Congestionamento', undefined]);
    const alt = linesForOption(driveOption(), false);
    expect(alt).toHaveLength(1);
    expect(alt[0]!.color).toBe('#8a96a8');
  });

  it('resume a extensão de cada categoria de trânsito', () => {
    const summary = trafficSummary(driveOption());
    expect(summary.map((s) => s.speed)).toEqual(['TRAFFIC_JAM', 'SLOW']);
    expect(summary[0]!.meters).toBeGreaterThan(100);
  });

  it('semáforos só para rotas de carro', () => {
    expect(drivePolylineForSignals(driveOption())).toBe(encodePolyline(PATH));
    expect(drivePolylineForSignals({ ...driveOption(), mode: 'walk' })).toBeNull();
    expect(drivePolylineForSignals(null)).toBeNull();
  });

  it('trecho aéreo é rotulado como representação e tracejado', () => {
    const flight: RouteOption = {
      ...driveOption(),
      id: 'flight-0',
      mode: 'flight',
      segments: [
        {
          kind: 'flight',
          durationSeconds: 6000,
          flight: { ident: 'TST1', scheduledOut: '2026-10-20T13:00:00Z', scheduledIn: '2026-10-20T14:40:00Z', isCodeshare: false, provider: 't' },
          from: { iata: 'BSB', name: 'A', countryCode: 'BR', location: { lat: -15.87, lng: -47.92 } },
          to: { iata: 'GRU', name: 'B', countryCode: 'BR', location: { lat: -23.43, lng: -46.47 } },
          departure: { instant: '2026-10-20T13:00:00Z' },
          arrival: { instant: '2026-10-20T14:40:00Z' },
        },
      ],
    };
    const [line] = linesForOption(flight, true);
    expect(line!.label).toBe('Representação do trecho aéreo');
    expect(line!.style).toBe('dashed');
  });

  it('lista estações de embarque e desembarque com a cor da linha', () => {
    const rail: RouteOption = {
      ...driveOption(),
      mode: 'rail',
      segments: [
        {
          kind: 'transit',
          durationSeconds: 900,
          line: { shortName: 'M1', color: '#1a7f37', vehicleType: 'SUBWAY', agencies: [] },
          departureStop: { name: 'Estação Alfa', location: { lat: 0, lng: 0 } },
          arrivalStop: { name: 'Estação Beta', location: { lat: 0, lng: 0.01 } },
          departure: { instant: '2026-10-20T11:07:00Z' },
          arrival: { instant: '2026-10-20T11:22:00Z' },
        },
      ],
    };
    expect(stationsOf(rail).map((s) => [s.stop.name, s.role, s.color])).toEqual([
      ['Estação Alfa', 'board', '#1a7f37'],
      ['Estação Beta', 'alight', '#1a7f37'],
    ]);
  });
});
