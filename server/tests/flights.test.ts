import { encodePolyline, type PlaceSummary } from '@nexus/shared';
import { describe, expect, it } from 'vitest';
import { parseCsv } from '../src/lib/csv';
import {
  AirportDirectory,
  parseOurAirportsCsv,
  selectNearbyAirports,
  type AirportRecord,
} from '../src/providers/airports/AirportDirectory';
import {
  AeroApiFlightProvider,
  mapSchedules,
} from '../src/providers/flights/AeroApiFlightProvider';
import {
  UnconfiguredFlightProvider,
  type FlightProvider,
  type ScheduledFlight,
} from '../src/providers/flights/FlightProvider';
import { FlightService } from '../src/services/FlightService';
import { RouteService } from '../src/services/RouteService';
import type { TimeZoneService } from '../src/services/TimeZoneService';
import { fakeRoutesClient } from './fixtures/routes';

// Linhas no formato real do airports.csv do OurAirports (dados de domínio público).
const CSV = `"id","ident","type","name","latitude_deg","longitude_deg","elevation_ft","continent","iso_country","iso_region","municipality","scheduled_service","icao_code","iata_code","gps_code","local_code","home_link","wikipedia_link","keywords"
5872,"SBBR","large_airport","Presidente Juscelino Kubitschek International Airport",-15.869167,-47.920834,3497,"SA","BR","BR-DF","Brasília","yes","SBBR","BSB","SBBR","DF0001",,,
5917,"SBGR","large_airport","Guarulhos - Governador André Franco Montoro International Airport",-23.431944,-46.469444,2461,"SA","BR","BR-SP","São Paulo","yes","SBGR","GRU","SBGR","SP0002",,,
5871,"SBSP","medium_airport","Congonhas Airport",-23.627657,-46.654601,2631,"SA","BR","BR-SP","São Paulo","yes","SBSP","CGH","SBSP","SP0001",,,"Congonhas, ""teste de aspas"""
1,"XHEL","heliport","Heliponto Sintético",-15.80,-47.90,0,"SA","BR","BR-DF","Brasília","no",,,,,,,
2,"XSML","small_airport","Pista Sintética",-15.81,-47.91,0,"SA","BR","BR-DF","Brasília","yes",,"XXS",,,,,
3,"XMED","medium_airport","Aeródromo sem voos regulares",-15.82,-47.92,0,"SA","BR","BR-DF","Brasília","no",,"XXM",,,,,
`;

describe('OurAirports', () => {
  it('CSV: aspas escapadas e vírgulas dentro de aspas', () => {
    expect(parseCsv('a,"b,c","d ""e"""\n1,2,3')).toEqual([
      ['a', 'b,c', 'd "e"'],
      ['1', '2', '3'],
    ]);
  });

  it('mantém só aeroportos de médio/grande porte com voos regulares e IATA', () => {
    const list = parseOurAirportsCsv(CSV);
    expect(list.map((a) => a.iata)).toEqual(['BSB', 'GRU', 'CGH']);
    expect(list[0]).toMatchObject({
      icao: 'SBBR',
      municipality: 'Brasília',
      countryCode: 'BR',
      size: 'large_airport',
    });
  });

  it('seleciona aeroportos por distância garantindo um de grande porte', () => {
    const list = parseOurAirportsCsv(CSV);
    const paulista = { lat: -23.5614, lng: -46.6559 };
    const near1 = selectNearbyAirports(list, paulista, 120, 1);
    // CGH é o mais próximo, mas é médio porte → troca pelo grande mais próximo (GRU).
    expect(near1.map((a) => a.iata)).toEqual(['GRU']);
    const near2 = selectNearbyAirports(list, paulista, 120, 2);
    expect(near2.map((a) => a.iata)).toEqual(['CGH', 'GRU']);
    expect(selectNearbyAirports(list, { lat: 53.55, lng: 9.99 }, 120, 2)).toEqual([]);
  });
});

describe('AeroAPI', () => {
  const raw = {
    scheduled: [
      {
        ident: 'TST1001',
        ident_iata: 'TS1001',
        actual_ident: null,
        actual_ident_iata: null,
        aircraft_type: 'A320',
        scheduled_out: '2026-10-20T17:10:00Z',
        scheduled_in: '2026-10-20T18:55:00Z',
        origin_iata: 'BSB',
        destination_iata: 'GRU',
      },
      // codeshare do mesmo voo físico
      {
        ident: 'XYZ9001',
        ident_iata: 'XY9001',
        actual_ident: 'TST1001',
        actual_ident_iata: 'TS1001',
        aircraft_type: 'A320',
        scheduled_out: '2026-10-20T17:10:00Z',
        scheduled_in: '2026-10-20T18:55:00Z',
        origin_iata: 'BSB',
        destination_iata: 'GRU',
      },
      {
        ident: 'TST1003',
        ident_iata: 'TS1003',
        actual_ident: null,
        actual_ident_iata: null,
        aircraft_type: 'B738',
        scheduled_out: '2026-10-20T12:00:00Z',
        scheduled_in: '2026-10-20T13:40:00Z',
        origin_iata: 'BSB',
        destination_iata: 'GRU',
      },
      // incompleto → ignorado
      {
        ident: 'TST1004',
        scheduled_out: '2026-10-20T12:00:00Z',
        origin_iata: 'BSB',
        destination_iata: 'GRU',
      },
    ],
    links: null,
    num_pages: 1,
  };

  it('mapeia horários publicados, ordena e remove duplicata de codeshare', () => {
    const flights = mapSchedules(raw);
    expect(flights.map((f) => f.ident)).toEqual(['TS1003', 'TS1001']);
    expect(flights[1]).toMatchObject({
      scheduledOut: '2026-10-20T17:10:00Z',
      scheduledIn: '2026-10-20T18:55:00Z',
      isCodeshare: false,
    });
  });

  it('chama /schedules com cabeçalho x-apikey e sem codeshares', async () => {
    let seen: { url: string; key: string | null } | null = null;
    const fetchFn = (async (url: string, init?: RequestInit) => {
      seen = { url, key: new Headers(init?.headers).get('x-apikey') };
      return new Response(JSON.stringify(raw), { status: 200 });
    }) as typeof fetch;
    const p = new AeroApiFlightProvider({
      apiKey: 'k-test',
      baseUrl: 'https://aeroapi.example/aeroapi',
      maxRequestsPerMinute: 10,
      fetchFn,
    });
    const flights = await p.searchDirectFlights({
      originIata: 'BSB',
      destinationIata: 'GRU',
      departureWindowStart: '2026-10-20T11:23:00Z',
      departureWindowEnd: '2026-10-21T11:23:00Z',
    });
    expect(flights).toHaveLength(2);
    expect(seen!.key).toBe('k-test');
    expect(seen!.url).toContain('/schedules/2026-10-20T11%3A00%3A00Z/2026-10-21T12%3A00%3A00Z?');
    expect(seen!.url).toContain('origin=BSB');
    expect(seen!.url).toContain('destination=GRU');
    expect(seen!.url).toContain('include_codeshares=false');
  });

  it('traduz erro de chave recusada e limite de taxa', async () => {
    const make = (status: number) =>
      new AeroApiFlightProvider({
        apiKey: 'x',
        baseUrl: 'https://aeroapi.example',
        maxRequestsPerMinute: 10,
        fetchFn: (async () =>
          new Response(JSON.stringify({ title: 'err', detail: 'd' }), { status })) as typeof fetch,
      });
    const q = {
      originIata: 'BSB',
      destinationIata: 'GRU',
      departureWindowStart: '2026-10-20T11:00:00Z',
      departureWindowEnd: '2026-10-21T11:00:00Z',
    };
    await expect(make(401).searchDirectFlights(q)).rejects.toMatchObject({
      code: 'UPSTREAM',
      message: expect.stringContaining('recusada'),
    });
    await expect(make(429).searchDirectFlights(q)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});

/* --------------------------------------------------------------- FlightService */

const NOW = new Date('2026-10-20T10:00:00Z');
const BRASILIA: PlaceSummary = {
  id: 'ChIJ_test_bsb_origin_01',
  name: 'Origem em Brasília (teste)',
  location: { lat: -15.7942, lng: -47.8822 },
  types: [],
  timeZone: 'America/Sao_Paulo',
  source: 'google_places',
};
const SAO_PAULO: PlaceSummary = {
  id: 'ChIJ_test_sp_destination',
  name: 'Destino em São Paulo (teste)',
  location: { lat: -23.5614, lng: -46.6559 },
  types: [],
  timeZone: 'America/Sao_Paulo',
  source: 'google_places',
};

class FakeFlights implements FlightProvider {
  readonly id = 'fake';
  readonly name = 'Fonte de voos de teste';
  readonly configured = true;
  readonly maxWindowMs = 21 * 86_400_000;
  readonly maxFutureMs = 365 * 86_400_000;
  queries: Array<{ o: string; d: string; start: string; end: string }> = [];
  constructor(private readonly flights: ScheduledFlight[]) {}
  async searchDirectFlights(q: {
    originIata: string;
    destinationIata: string;
    departureWindowStart: string;
    departureWindowEnd: string;
  }) {
    this.queries.push({
      o: q.originIata,
      d: q.destinationIata,
      start: q.departureWindowStart,
      end: q.departureWindowEnd,
    });
    return this.flights.filter(
      (f) => f.originIata === q.originIata && f.destinationIata === q.destinationIata,
    );
  }
}

const tz = {
  zoneFor: async () => 'America/Sao_Paulo',
  configured: true,
} as unknown as TimeZoneService;

function flightService(
  provider: FlightProvider,
  opts: Partial<ConstructorParameters<typeof FlightService>[4]> = {},
) {
  const leg = encodePolyline([
    { lat: -15.79, lng: -47.88 },
    { lat: -15.86, lng: -47.92 },
  ]);
  const { client, calls } = fakeRoutesClient((body) => ({
    routes: [
      {
        duration: '1800s',
        staticDuration: '1500s',
        distanceMeters: 20000,
        polyline: { encodedPolyline: leg },
        legs: [{ steps: [] }],
      },
    ],
    geocodingResults: {
      origin: {
        type: 'address' in body.origin ? ['airport', 'establishment'] : ['street_address'],
      },
      destination: {
        type: 'address' in body.destination ? ['airport', 'establishment'] : ['street_address'],
      },
    },
  }));
  const routes = new RouteService(client, {
    languageCode: 'pt-BR',
    regionCode: 'BR',
    trafficOnPolyline: true,
    tolls: true,
    now: () => NOW,
  });
  const airports = AirportDirectory.fromRecords(parseOurAirportsCsv(CSV) as AirportRecord[]);
  const svc = new FlightService(provider, airports, routes, tz, {
    minDistanceKm: 100,
    airportSearchRadiusKm: 120,
    maxAirportsPerSide: 2,
    maxOptions: 3,
    now: () => NOW,
    ...opts,
  });
  return { svc, calls };
}

const baseReq = {
  origin: BRASILIA,
  destination: SAO_PAULO,
  preDepartureMarginMinutes: 90,
  postArrivalMarginMinutes: 30,
};

describe('FlightService', () => {
  it('sem provedor configurado → not_configured (nenhum voo simulado)', async () => {
    const { svc } = flightService(new UnconfiguredFlightProvider());
    const r = await svc.flight({ ...baseReq, time: { mode: 'now' } });
    expect(r.status).toBe('not_configured');
    expect(r.options).toEqual([]);
  });

  it('trajeto curto → não há rota aérea adequada', async () => {
    const { svc } = flightService(new FakeFlights([]));
    const r = await svc.flight({
      ...baseReq,
      destination: { ...SAO_PAULO, location: { lat: -15.83, lng: -47.91 } },
      time: { mode: 'now' },
    });
    expect(r.status).toBe('unavailable');
    expect(r.message).toContain('Não há rota aérea adequada disponível');
  });

  it('sem voos publicados → mensagem de ausência de voo', async () => {
    const provider = new FakeFlights([]);
    const { svc } = flightService(provider);
    const r = await svc.flight({ ...baseReq, time: { mode: 'now' } });
    expect(r.status).toBe('unavailable');
    expect(r.message).toBe(
      'Não encontramos voos diretos publicados entre os aeroportos próximos no período escolhido.',
    );
    expect(provider.queries.map((q) => `${q.o}-${q.d}`)).toEqual(['BSB-CGH', 'BSB-GRU']);
    expect(r.meta?.originAirports.map((a) => a.iata)).toEqual(['BSB']);
  });

  it('monta a viagem porta a porta: carro → margem → voo → margem → carro', async () => {
    const provider = new FakeFlights([
      {
        ident: 'TS1003',
        originIata: 'BSB',
        destinationIata: 'GRU',
        scheduledOut: '2026-10-20T13:00:00Z',
        scheduledIn: '2026-10-20T14:40:00Z',
        isCodeshare: false,
      },
      // parte cedo demais (antes de dar tempo de chegar ao aeroporto + margem)
      {
        ident: 'TS0999',
        originIata: 'BSB',
        destinationIata: 'CGH',
        scheduledOut: '2026-10-20T10:30:00Z',
        scheduledIn: '2026-10-20T12:10:00Z',
        isCodeshare: false,
      },
    ]);
    const { svc, calls } = flightService(provider);
    const r = await svc.flight({ ...baseReq, time: { mode: 'now' } });
    expect(r.status).toBe('available');
    expect(r.options).toHaveLength(1);
    const o = r.options[0]!;
    expect(o.segments.map((s) => s.kind)).toEqual(['drive', 'buffer', 'flight', 'buffer', 'drive']);
    const flight = o.segments[2]!;
    if (flight.kind !== 'flight') throw new Error();
    expect(flight.flight.ident).toBe('TS1003');
    expect(flight.from.iata).toBe('BSB');
    expect(flight.to.iata).toBe('GRU');
    expect(flight.durationSeconds).toBe(100 * 60);
    expect(flight.departure).toEqual({
      instant: '2026-10-20T13:00:00Z',
      timeZone: 'America/Sao_Paulo',
    });

    // Saída de casa = partida (13:00Z) − margem (90 min) − carro (30 min) = 11:00Z;
    // chegada = pouso (14:40Z) + margem (30 min) + carro (30 min) = 15:40Z.
    expect(o.departure.instant).toBe('2026-10-20T11:00:00Z');
    expect(o.arrival.instant).toBe('2026-10-20T15:40:00Z');
    const [, pre, , post] = o.segments;
    expect(pre?.kind === 'buffer' && pre.label).toContain('margem escolhida: 1h30');
    expect(post?.kind === 'buffer' && post.durationSeconds).toBe(30 * 60);
    expect(o.scheduleNote).toContain('não são tempos oficiais');

    // Terminal geocodificado pela Routes API (endereço), conferido como "airport".
    expect(calls.some((c) => 'address' in c.body.destination)).toBe(true);
    expect(o.warnings.some((w) => w.includes('coordenada de referência'))).toBe(false);
  });

  it('chegar até: descarta voos que chegariam tarde demais', async () => {
    const provider = new FakeFlights([
      {
        ident: 'TS2001',
        originIata: 'BSB',
        destinationIata: 'GRU',
        scheduledOut: '2026-10-20T13:00:00Z',
        scheduledIn: '2026-10-20T14:40:00Z',
        isCodeshare: false,
      },
      {
        ident: 'TS2002',
        originIata: 'BSB',
        destinationIata: 'GRU',
        scheduledOut: '2026-10-20T15:00:00Z',
        scheduledIn: '2026-10-20T16:40:00Z',
        isCodeshare: false,
      },
    ]);
    const { svc } = flightService(provider);
    // Chegar até 13:00 local (16:00Z): o TS2002 pousaria 16:40Z → descartado.
    const r = await svc.flight({
      ...baseReq,
      time: { mode: 'arrive_by', instant: '2026-10-20T16:00:00Z' },
    });
    expect(
      r.options.map((o) => (o.segments[2]!.kind === 'flight' ? o.segments[2]!.flight.ident : '')),
    ).toEqual(['TS2001']);
  });
});
