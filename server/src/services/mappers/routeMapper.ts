import {
  decodePolyline,
  parseGoogleDuration,
  type Bounds,
  type LatLng,
  type NavigationStep,
  type PlaceSummary,
  type TollInfo,
  type TrafficInterval,
} from '@nexus/shared';
import type {
  RawLatLng,
  RawLocation,
  RawMoney,
  RawRoute,
  RawSpeedReadingInterval,
  RawStep,
  RawWaypoint,
} from '../../providers/google/routesTypes';

/**
 * Ponto de rota no servidor. `addressQuery` permite que a Routes API geocodifique um local
 * (ex.: o terminal de um aeroporto) em vez de rotear até a coordenada de referência do
 * aeroporto, que costuma ficar no meio da pista.
 */
export type Endpoint = PlaceSummary & { addressQuery?: string; expectedType?: string };

export function toWaypoint(place: Endpoint, useAddress = true): RawWaypoint {
  if (place.id) return { placeId: place.id };
  if (useAddress && place.addressQuery) return { address: place.addressQuery };
  return { location: { latLng: { latitude: place.location.lat, longitude: place.location.lng } } };
}

export function fromRawLatLng(raw: RawLatLng | undefined): LatLng | undefined {
  if (raw?.latitude === undefined || raw.longitude === undefined) return undefined;
  return { lat: raw.latitude, lng: raw.longitude };
}

export function fromRawLocation(raw: RawLocation | undefined): LatLng | undefined {
  return fromRawLatLng(raw?.latLng);
}

export function viewportToBounds(route: RawRoute): Bounds | undefined {
  const low = fromRawLatLng(route.viewport?.low);
  const high = fromRawLatLng(route.viewport?.high);
  if (!low || !high) return undefined;
  return { south: low.lat, west: low.lng, north: high.lat, east: high.lng };
}

/** Instruções vêm literalmente do mecanismo de navegação; passos sem texto são descartados. */
export function mapSteps(steps: RawStep[] | undefined): NavigationStep[] {
  const out: NavigationStep[] = [];
  for (const s of steps ?? []) {
    const text = s.navigationInstruction?.instructions?.trim();
    if (!text) continue;
    out.push({
      instruction: text,
      maneuver: s.navigationInstruction?.maneuver,
      distanceMeters: s.distanceMeters,
      durationSeconds: parseGoogleDuration(s.staticDuration),
      startLocation: fromRawLocation(s.startLocation),
    });
  }
  return out;
}

/**
 * Converte SpeedReadingIntervals em intervalos válidos da polilinha.
 * Índice inicial ausente = 0 (proto3, conforme a documentação). Intervalos fora do
 * tamanho da polilinha ou vazios são descartados em vez de "corrigidos".
 */
export function mapTrafficIntervals(
  raw: RawSpeedReadingInterval[] | undefined,
  pointCount: number,
): TrafficInterval[] | undefined {
  if (!raw || raw.length === 0) return undefined;
  const out: TrafficInterval[] = [];
  for (const r of raw) {
    const start = r.startPolylinePointIndex ?? 0;
    const end = r.endPolylinePointIndex ?? 0;
    if (r.speed !== 'NORMAL' && r.speed !== 'SLOW' && r.speed !== 'TRAFFIC_JAM') continue;
    if (end <= start || end >= pointCount || start < 0) continue;
    out.push({ start, end, speed: r.speed });
  }
  return out.length > 0 ? out : undefined;
}

export function moneyToNumber(m: RawMoney): number {
  return Number(m.units ?? 0) + (m.nanos ?? 0) / 1e9;
}

/**
 * Documentação TollInfo: campo ausente = não há pedágio previsto; presente sem
 * estimatedPrice = há pedágio mas o valor é desconhecido.
 */
export function mapTolls(route: RawRoute, requested: boolean): TollInfo | undefined {
  if (!requested) return undefined;
  const info = route.travelAdvisory?.tollInfo;
  if (!info) return { present: false, estimatedPrices: [] };
  return {
    present: true,
    estimatedPrices: (info.estimatedPrice ?? [])
      .filter((p) => p.currencyCode)
      .map((p) => ({ currencyCode: p.currencyCode!, amount: moneyToNumber(p) })),
  };
}

export function polylinePointCount(encoded: string | undefined): number {
  return encoded ? decodePolyline(encoded).length : 0;
}
