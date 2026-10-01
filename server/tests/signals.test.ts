import { DEMO_SIGNAL_BANNER, encodePolyline, SIGNAL_NO_TELEMETRY_MESSAGE, type LatLng, type SignalStateUpdate, type TrafficSignalFeature } from '@nexus/shared';
import { describe, expect, it } from 'vitest';
import { DemoTrafficSignalProvider, simulatedPhaseAt } from '../src/providers/signals/demo/DemoTrafficSignalProvider';
import { HamburgTldProvider, corridorPolygons, toLaneConnection } from '../src/providers/signals/hamburg/HamburgTldProvider';
import { isMotorVehicleLane, matchLaneConnection, phaseFromTldCode, type LaneConnection } from '../src/providers/signals/hamburg/laneMatching';
import { mapOverpassSignals } from '../src/providers/signals/OsmTrafficSignalLocator';
import { buildRouteGeometry, type TrafficSignalProvider } from '../src/providers/signals/TrafficSignalProvider';
import { mergeFeatures, TrafficSignalService } from '../src/services/TrafficSignalService';

/*
 * Cenário SINTÉTICO em Hamburgo: uma avenida reta no sentido sul → norte com um cruzamento
 * em lat 53.5600. A rota segue para o norte e passa reto pelo cruzamento.
 */
const LNG = 9.99;
const ROUTE_NORTH: LatLng[] = [
  { lat: 53.5570, lng: LNG },
  { lat: 53.5590, lng: LNG },
  { lat: 53.5600, lng: LNG },
  { lat: 53.5610, lng: LNG },
  { lat: 53.5630, lng: LNG },
];
const routeNorth = buildRouteGeometry(encodePolyline(ROUTE_NORTH))!;
const routeSouth = buildRouteGeometry(encodePolyline([...ROUTE_NORTH].reverse()))!;

const NOW = new Date('2026-10-01T17:00:00Z');

/** Conexão "seguir reto para o norte": entrada começa na linha de retenção e vai para o sul. */
function straightNorth(overrides: Partial<LaneConnection> = {}): LaneConnection {
  return {
    thingId: 1,
    name: '900_1',
    trafficLightsId: '900',
    laneType: 'KFZ',
    signalGroup: 'K1',
    lines: [
      [{ lat: 53.55985, lng: LNG }, { lat: 53.5590, lng: LNG }, { lat: 53.5580, lng: LNG }], // entrada (retenção → montante)
      [{ lat: 53.55985, lng: LNG }, { lat: 53.56015, lng: LNG }], // dentro do cruzamento
      [{ lat: 53.56015, lng: LNG }, { lat: 53.5610, lng: LNG }, { lat: 53.5620, lng: LNG }], // saída (cruzamento → jusante)
    ],
    datastreamId: 15,
    latest: { phenomenonTime: '2026-10-01T16:59:50Z', resultTime: '2026-10-01T16:59:51Z', result: 3 },
    ...overrides,
  };
}

/** Conexão da via transversal (leste → oeste) no mesmo cruzamento. */
function crossWest(): LaneConnection {
  return {
    thingId: 2,
    name: '900_2',
    trafficLightsId: '900',
    laneType: 'KFZ',
    lines: [
      [{ lat: 53.5600, lng: LNG + 0.0003 }, { lat: 53.5600, lng: LNG + 0.0015 }],
      [{ lat: 53.5600, lng: LNG + 0.0003 }, { lat: 53.5600, lng: LNG - 0.0003 }],
      [{ lat: 53.5600, lng: LNG - 0.0003 }, { lat: 53.5600, lng: LNG - 0.0015 }],
    ],
    datastreamId: 16,
    latest: { phenomenonTime: '2026-10-01T16:59:40Z', result: 1 },
  };
}

const provider = () => new HamburgTldProvider({ baseUrl: 'https://tld.example/v1.1', staleAfterSeconds: 300, now: () => NOW });

describe('associação da fase ao sentido do veículo (Hamburg TLD)', () => {
  it('associa a faixa que segue no mesmo sentido da rota', () => {
    const m = matchLaneConnection(straightNorth(), routeNorth);
    expect(m).not.toBeNull();
    expect(m!.travelDirection).toBe('sentido sul → norte');
  });

  it('NÃO associa no sentido oposto da mesma via', () => {
    expect(matchLaneConnection(straightNorth(), routeSouth)).toBeNull();
  });

  it('NÃO associa a via transversal', () => {
    expect(matchLaneConnection(crossWest(), routeNorth)).toBeNull();
  });

  it('NÃO associa faixa longe da rota', () => {
    const far = straightNorth({
      lines: straightNorth().lines.map((l) => l.map((p) => ({ lat: p.lat, lng: p.lng + 0.001 }))),
    });
    expect(matchLaneConnection(far, routeNorth)).toBeNull();
  });

  it('mapeia apenas os códigos documentados de primary_signal', () => {
    expect(phaseFromTldCode(1)).toBe('red');
    expect(phaseFromTldCode(3)).toBe('green');
    expect(phaseFromTldCode(4)).toBe('red_amber');
    expect(phaseFromTldCode(9)).toBe('unknown');
    expect(phaseFromTldCode(7)).toBeNull();
    expect(phaseFromTldCode(undefined)).toBeNull();
  });

  it('filtra faixas de veículos motorizados', () => {
    expect(isMotorVehicleLane('KFZ')).toBe(true);
    expect(isMotorVehicleLane('KFZ/Radfahrer')).toBe(true);
    expect(isMotorVehicleLane('Radfahrer')).toBe(false);
    expect(isMotorVehicleLane('Fußgänger')).toBe(false);
  });
});

describe('HamburgTldProvider.buildFeatures', () => {
  it('fase ao vivo somente para a aproximação do trajeto; sem contagem regressiva', () => {
    const features = provider().buildFeatures([straightNorth(), crossWest()], routeNorth);
    expect(features).toHaveLength(1);
    const f = features[0]!;
    expect(f.telemetry.status).toBe('live');
    if (f.telemetry.status !== 'live') throw new Error();
    expect(f.telemetry.supportsCountdown).toBe(false);
    expect(f.telemetry.approaches).toEqual([
      expect.objectContaining({
        streamId: 'hamburg_tld:15',
        phase: 'green',
        phaseSince: '2026-10-01T16:59:50Z',
        stale: false,
        travelDirection: 'sentido sul → norte',
      }),
    ]);
    expect(f.telemetry.approaches[0]!.nextChangeAt).toBeUndefined();
  });

  it('no sentido oposto: cruzamento identificado, mas sem fase (direction_unknown)', () => {
    const features = provider().buildFeatures([straightNorth(), crossWest()], routeSouth);
    expect(features).toHaveLength(1);
    expect(features[0]!.telemetry.status).toBe('direction_unknown');
    expect(JSON.stringify(features[0])).not.toMatch(/"phase"/);
  });

  it('marca observação antiga como desatualizada e ausência de observação como fase nula', () => {
    const old = straightNorth({ latest: { phenomenonTime: '2026-10-01T16:40:00Z', result: 3 } });
    const none = straightNorth({ thingId: 3, name: '900_3', datastreamId: 17, latest: undefined });
    const f = provider().buildFeatures([old, none], routeNorth)[0]!;
    if (f.telemetry.status !== 'live') throw new Error();
    expect(f.telemetry.approaches.map((a) => [a.streamId, a.phase, a.stale])).toEqual([
      ['hamburg_tld:15', 'green', true],
      ['hamburg_tld:17', null, false],
    ]);
  });

  it('converte o MultiLineString da SensorThings (lng, lat) corretamente', () => {
    const c = toLaneConnection({
      '@iot.id': 2,
      name: '353_12',
      properties: { trafficLightsID: '353', laneType: 'KFZ/Radfahrer' },
      Locations: [{ location: { geometry: { type: 'MultiLineString', coordinates: [[[9.9196439, 53.5638321], [9.9197085, 53.5637359]], [[9.91970, 53.56373], [9.91955, 53.56396]]] } } }],
      Datastreams: [{ '@iot.id': 15, properties: { layerName: 'primary_signal', signalGroupID: 'K5' }, Observations: [{ result: 1 }] }],
    });
    expect(c).toMatchObject({ trafficLightsId: '353', signalGroup: 'K5', datastreamId: 15 });
    expect(c!.lines[0]![0]).toEqual({ lat: 53.5638321, lng: 9.9196439 });
  });

  it('divide a rota em corredores para a consulta espacial', () => {
    const polys = corridorPolygons(routeNorth.path);
    expect(polys.length).toBeGreaterThanOrEqual(1);
    for (const p of polys) expect(p.north).toBeGreaterThan(p.south);
  });

  it('só se aplica a rotas na área de Hamburgo', () => {
    const brasilia = buildRouteGeometry(encodePolyline([{ lat: -15.79, lng: -47.88 }, { lat: -15.83, lng: -47.91 }]))!;
    expect(provider().appliesTo(routeNorth)).toBe(true);
    expect(provider().appliesTo(brasilia)).toBe(false);
  });
});

describe('OpenStreetMap: semáforo sem telemetria', () => {
  it('gera marcador sem estado (cinza) e descarta nós longe da rota', () => {
    const features = mapOverpassSignals(
      {
        elements: [
          { type: 'node', id: 101, lat: 53.5600, lon: LNG + 0.0001, tags: { highway: 'traffic_signals' } },
          { type: 'node', id: 102, lat: 53.5600, lon: LNG + 0.01, tags: { highway: 'traffic_signals' } },
          { type: 'node', id: 103, lat: 53.5610, lon: LNG, tags: { highway: 'crossing' } },
        ],
      },
      routeNorth,
    );
    expect(features).toHaveLength(1);
    expect(features[0]!.telemetry).toEqual({ status: 'none', reason: SIGNAL_NO_TELEMETRY_MESSAGE });
    expect(features[0]!.sources[0]!.reference).toBe('https://www.openstreetmap.org/node/101');
    expect(JSON.stringify(features[0])).not.toMatch(/"phase"|nextChangeAt/);
  });
});

/* ------------------------------------------------------------- serviço */

function staticLocator(features: TrafficSignalFeature[] | Error) {
  return {
    id: 'osm',
    name: 'OSM (teste)',
    attribution: 'teste',
    findAlongRoute: async () => {
      if (features instanceof Error) throw features;
      return features;
    },
  };
}

function telemetryProvider(features: TrafficSignalFeature[] | Error, applies = true): TrafficSignalProvider {
  return {
    id: 'hamburg_tld',
    name: 'Telemetria (teste)',
    attribution: 'teste',
    supportsCountdown: false,
    appliesTo: () => applies,
    findAlongRoute: async () => {
      if (features instanceof Error) throw features;
      return features;
    },
    getStates: async (ids: string[]): Promise<SignalStateUpdate[]> => ids.map((streamId) => ({ streamId, phase: 'red', stale: false })),
    subscribe: () => () => undefined,
  };
}

const osmNode = (id: number, lat: number): TrafficSignalFeature => ({
  id: `osm:node/${id}`,
  location: { lat, lng: LNG },
  label: 'Semáforo (OpenStreetMap)',
  distanceAlongRouteMeters: Math.round((lat - 53.557) * 111_000),
  sources: [{ provider: 'OSM', attribution: 'OSM', reference: `https://www.openstreetmap.org/node/${id}` }],
  telemetry: { status: 'none', reason: SIGNAL_NO_TELEMETRY_MESSAGE },
});

describe('TrafficSignalService', () => {
  const encoded = encodePolyline(ROUTE_NORTH);

  it('sem telemetria: somente marcadores sem estado e aviso explícito', async () => {
    const svc = new TrafficSignalService([staticLocator([osmNode(1, 53.5600)])], [telemetryProvider([], false)], { maxRouteKm: 60, now: () => NOW });
    const r = await svc.alongRoute(encoded);
    expect(r.status).toBe('ok');
    expect(r.features.every((f) => f.telemetry.status === 'none')).toBe(true);
    expect(r.messages).toContain('Nenhuma fonte de telemetria de semáforos está disponível para esta rota. Os semáforos são exibidos sem estado.');
    expect(r.providers.find((p) => p.id === 'hamburg_tld')?.status).toBe('not_applicable');
  });

  it('falha de um provedor não vira dado: aparece como erro na resposta', async () => {
    const svc = new TrafficSignalService([staticLocator(new Error('rede'))], [], { maxRouteKm: 60, now: () => NOW });
    const r = await svc.alongRoute(encoded);
    expect(r.status).toBe('unavailable');
    expect(r.features).toEqual([]);
    expect(r.providers[0]).toMatchObject({ id: 'osm', status: 'error' });
  });

  it('rota longa demais não consulta as fontes', async () => {
    let called = false;
    const loc = { ...staticLocator([]), findAlongRoute: async () => ((called = true), []) };
    const svc = new TrafficSignalService([loc], [], { maxRouteKm: 0.1, now: () => NOW });
    const r = await svc.alongRoute(encoded);
    expect(r.status).toBe('route_too_long');
    expect(called).toBe(false);
  });

  it('une o nó OSM ao semáforo com telemetria do mesmo cruzamento', () => {
    const live = provider().buildFeatures([straightNorth()], routeNorth);
    const merged = mergeFeatures(live, [osmNode(1, 53.5599), osmNode(2, 53.5625)]);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.sources).toHaveLength(2);
    expect(merged[1]!.telemetry.status).toBe('none');
  });

  it('modo demonstração é recusado quando desligado', () => {
    const svc = new TrafficSignalService([], [], { maxRouteKm: 60 });
    expect(() => svc.demoAlongRoute(encoded)).toThrow('desativado');
  });

  it('modo demonstração (ligado) marca tudo como simulado e não usa locais reais', () => {
    const svc = new TrafficSignalService([], [], { maxRouteKm: 60 }, new DemoTrafficSignalProvider(() => NOW));
    const r = svc.demoAlongRoute(encoded);
    expect(r.simulated).toBe(true);
    expect(r.banner).toBe(DEMO_SIGNAL_BANNER);
    expect(r.features.every((f) => f.simulated && f.label.includes('simulado'))).toBe(true);
  });

  it('ciclo simulado é determinístico (sem aleatoriedade)', () => {
    const a = simulatedPhaseAt(NOW.getTime(), 0);
    const b = simulatedPhaseAt(NOW.getTime(), 0);
    expect(a).toEqual(b);
    expect(a.nextChangeMs).toBeGreaterThan(NOW.getTime() - 1000);
  });

  it('roteia o estado de cada fluxo para o provedor certo', async () => {
    const svc = new TrafficSignalService([], [telemetryProvider([])], { maxRouteKm: 60, now: () => NOW });
    const snap = await svc.states(['hamburg_tld:15', 'outro:1']);
    expect(snap.states).toEqual([{ streamId: 'hamburg_tld:15', phase: 'red', stale: false }]);
  });
});

