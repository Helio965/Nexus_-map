import { encodePolyline, type PlaceSummary, type ResolvedTimeRequest, type RouteRequest } from '@nexus/shared';
import type { GoogleRoutesClient } from '../../src/providers/google/GoogleRoutesClient';
import type { ComputeRoutesBody, RawComputeRoutesResponse, RawRoute, RawStep } from '../../src/providers/google/routesTypes';

/** Fixtures SINTÉTICAS no formato da Routes API v2 (somente para testes). */

export const ORIGIN: PlaceSummary = {
  id: 'ChIJ_origin_test_000001',
  name: 'Origem de teste',
  address: 'Endereço sintético de origem',
  location: { lat: -15.7942, lng: -47.8822 },
  types: ['point_of_interest'],
  timeZone: 'America/Sao_Paulo',
  source: 'google_places',
};

export const DESTINATION: PlaceSummary = {
  id: 'ChIJ_destination_test_02',
  name: 'Destino de teste',
  address: 'Endereço sintético de destino',
  location: { lat: -15.8350, lng: -47.9120 },
  types: ['university'],
  timeZone: 'America/Sao_Paulo',
  source: 'google_places',
};

export const DRIVE_PATH = [
  { lat: -15.7942, lng: -47.8822 },
  { lat: -15.8000, lng: -47.8860 },
  { lat: -15.8080, lng: -47.8920 },
  { lat: -15.8150, lng: -47.8990 },
  { lat: -15.8250, lng: -47.9050 },
  { lat: -15.8350, lng: -47.9120 },
];

export function request(time: ResolvedTimeRequest): RouteRequest {
  return { origin: ORIGIN, destination: DESTINATION, time };
}

export function driveRoute(overrides: Partial<RawRoute> = {}): RawRoute {
  return {
    routeLabels: ['DEFAULT_ROUTE'],
    distanceMeters: 8400,
    duration: '1080s',
    staticDuration: '900s',
    polyline: { encodedPolyline: encodePolyline(DRIVE_PATH) },
    description: 'Via Eixo Sintético',
    warnings: [],
    viewport: { low: { latitude: -15.835, longitude: -47.912 }, high: { latitude: -15.7942, longitude: -47.8822 } },
    travelAdvisory: {
      speedReadingIntervals: [
        // sem startPolylinePointIndex = 0 (proto3)
        { endPolylinePointIndex: 2, speed: 'NORMAL' },
        { startPolylinePointIndex: 2, endPolylinePointIndex: 4, speed: 'TRAFFIC_JAM' },
        { startPolylinePointIndex: 4, endPolylinePointIndex: 5, speed: 'SLOW' },
        // inválido: além do fim da polilinha → descartado
        { startPolylinePointIndex: 5, endPolylinePointIndex: 99, speed: 'SLOW' },
      ],
      tollInfo: { estimatedPrice: [{ currencyCode: 'BRL', units: '7', nanos: 500000000 }] },
    },
    legs: [
      {
        steps: [
          step('Siga para o sul na Via Sintética A', 'DEPART', 1200, '120s', DRIVE_PATH[0]!),
          step('Vire à direita na Via Sintética B', 'TURN_RIGHT', 3000, '300s', DRIVE_PATH[2]!),
          step('Pegue o acesso para a Via Sintética C', 'RAMP_LEFT', 4200, '480s', DRIVE_PATH[4]!),
        ],
      },
    ],
    ...overrides,
  };
}

export function step(instructions: string, maneuver: string, distanceMeters: number, staticDuration: string, at: { lat: number; lng: number }): RawStep {
  return {
    distanceMeters,
    staticDuration,
    navigationInstruction: { instructions, maneuver },
    startLocation: { latLng: { latitude: at.lat, longitude: at.lng } },
  };
}

export interface FakeRoutesCall {
  body: ComputeRoutesBody;
  fieldMask: string;
}

/** Cliente falso: registra as chamadas e devolve o que o handler decidir. */
export function fakeRoutesClient(handler: (body: ComputeRoutesBody, fieldMask: string, n: number) => RawComputeRoutesResponse) {
  const calls: FakeRoutesCall[] = [];
  const client = {
    configured: true,
    computeRoutes: async (body: ComputeRoutesBody, fieldMask: string) => {
      calls.push({ body, fieldMask });
      return handler(body, fieldMask, calls.length);
    },
  } as unknown as GoogleRoutesClient;
  return { client, calls };
}

/* ------------------------------------------------------------------ transit */

const STATION_A = { latitude: -15.7990, longitude: -47.8850 };
const STATION_B = { latitude: -15.8200, longitude: -47.9000 };
const STATION_C = { latitude: -15.8300, longitude: -47.9080 };

function walk(text: string, seconds: number, meters: number): RawStep {
  return {
    travelMode: 'WALK',
    distanceMeters: meters,
    staticDuration: `${seconds}s`,
    polyline: { encodedPolyline: encodePolyline([DRIVE_PATH[0]!, DRIVE_PATH[1]!]) },
    navigationInstruction: { instructions: text },
  };
}

function ride(
  vehicleType: string,
  line: string,
  dep: string,
  arr: string,
  from: string,
  to: string,
  stopCount: number,
  headsign: string,
  fromLoc = STATION_A,
  toLoc = STATION_B,
): RawStep {
  return {
    travelMode: 'TRANSIT',
    distanceMeters: 5000,
    staticDuration: '900s',
    polyline: { encodedPolyline: encodePolyline([DRIVE_PATH[1]!, DRIVE_PATH[4]!]) },
    transitDetails: {
      stopDetails: {
        departureStop: { name: from, location: { latLng: fromLoc } },
        arrivalStop: { name: to, location: { latLng: toLoc } },
        departureTime: dep,
        arrivalTime: arr,
      },
      localizedValues: {
        departureTime: { time: { text: '' }, timeZone: 'America/Sao_Paulo' },
        arrivalTime: { time: { text: '' }, timeZone: 'America/Sao_Paulo' },
      },
      headsign,
      headway: '600s',
      stopCount,
      transitLine: {
        name: `Linha ${line}`,
        nameShort: line,
        color: '#1a7f37',
        textColor: '#ffffff',
        agencies: [{ name: 'Operadora Sintética' }],
        vehicle: { name: { text: vehicleType === 'BUS' ? 'Ônibus' : 'Metrô' }, type: vehicleType },
      },
    },
  };
}

/** 20/10/2026: caminhada 5 min → metrô 08:07–08:22 → baldeação → trem 08:28–08:40 → caminhada 6 min. */
export function railRoute(): RawRoute {
  return {
    distanceMeters: 11200,
    duration: '2940s',
    polyline: { encodedPolyline: encodePolyline(DRIVE_PATH) },
    legs: [
      {
        steps: [
          walk('Caminhe até Estação Alfa', 300, 350),
          ride('SUBWAY', 'M1', '2026-10-20T11:07:00Z', '2026-10-20T11:22:00Z', 'Estação Alfa', 'Estação Beta', 6, 'Terminal Sintético Sul'),
          walk('Caminhe até a plataforma da Estação Beta', 120, 90),
          ride('HEAVY_RAIL', 'T2', '2026-10-20T11:28:00Z', '2026-10-20T11:40:00Z', 'Estação Beta', 'Estação Gama', 3, 'Terminal Sintético Oeste', STATION_B, STATION_C),
          walk('Caminhe até o destino', 360, 420),
        ],
      },
    ],
  };
}

export function busRoute(): RawRoute {
  return {
    distanceMeters: 9000,
    duration: '2400s',
    legs: [
      {
        steps: [
          walk('Caminhe até a parada', 200, 200),
          ride('BUS', '0.110', '2026-10-20T11:05:00Z', '2026-10-20T11:35:00Z', 'Parada Sintética 1', 'Parada Sintética 2', 12, 'Rodoviária Sintética'),
        ],
      },
    ],
  };
}
