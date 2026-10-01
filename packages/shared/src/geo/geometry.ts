import type { Bounds, LatLng } from '../types/geo';

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** Distância de grande círculo (haversine) em metros. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Rumo inicial de a → b em graus (0 = norte, 90 = leste). */
export function bearingDegrees(a: LatLng, b: LatLng): number {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

const CARDINALS = ['norte', 'nordeste', 'leste', 'sudeste', 'sul', 'sudoeste', 'oeste', 'noroeste'];

export function cardinalName(bearing: number): string {
  const idx = Math.round((((bearing % 360) + 360) % 360) / 45) % 8;
  return CARDINALS[idx]!;
}

/** "sentido norte → sul" para um deslocamento com o rumo informado (rumo 180 = indo para o sul). */
export function travelDirectionLabel(bearing: number): string {
  const to = cardinalName(bearing);
  const from = cardinalName(bearing + 180);
  return `sentido ${from} → ${to}`;
}

export function pathLengthMeters(path: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += haversineMeters(path[i - 1]!, path[i]!);
  return total;
}

export function cumulativeDistances(path: LatLng[]): number[] {
  const out = new Array<number>(path.length);
  let total = 0;
  for (let i = 0; i < path.length; i++) {
    if (i > 0) total += haversineMeters(path[i - 1]!, path[i]!);
    out[i] = total;
  }
  return out;
}

export interface PathProjection {
  /** Distância ao longo do caminho até o ponto projetado (m). */
  distanceAlong: number;
  /** Distância perpendicular do ponto ao caminho (m). */
  lateral: number;
  segmentIndex: number;
  /** Rumo do segmento onde o ponto foi projetado. */
  segmentBearing: number;
}

/**
 * Projeta um ponto no caminho (aproximação equirretangular local por segmento —
 * erro desprezível para segmentos de rua de poucos km).
 */
export function projectOntoPath(
  point: LatLng,
  path: LatLng[],
  cumulative: number[] = cumulativeDistances(path),
): PathProjection | null {
  if (path.length === 0) return null;
  if (path.length === 1) {
    return {
      distanceAlong: 0,
      lateral: haversineMeters(point, path[0]!),
      segmentIndex: 0,
      segmentBearing: 0,
    };
  }
  let best: PathProjection | null = null;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const latRef = toRad((a.lat + b.lat) / 2);
    const mPerDegLat = (Math.PI / 180) * EARTH_RADIUS_M;
    const mPerDegLng = mPerDegLat * Math.cos(latRef);
    const bx = (b.lng - a.lng) * mPerDegLng;
    const by = (b.lat - a.lat) * mPerDegLat;
    const px = (point.lng - a.lng) * mPerDegLng;
    const py = (point.lat - a.lat) * mPerDegLat;
    const len2 = bx * bx + by * by;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2));
    const dx = px - t * bx;
    const dy = py - t * by;
    const lateral = Math.sqrt(dx * dx + dy * dy);
    if (!best || lateral < best.lateral) {
      best = {
        distanceAlong: cumulative[i]! + t * Math.sqrt(len2),
        lateral,
        segmentIndex: i,
        segmentBearing: bearingDegrees(a, b),
      };
    }
  }
  return best;
}

/** Ponto a uma distância (m) ao longo do caminho a partir do início. */
export function pointAlongPath(path: LatLng[], distance: number): LatLng | null {
  if (path.length === 0) return null;
  let remaining = Math.max(0, distance);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const seg = haversineMeters(a, b);
    if (remaining <= seg) {
      const t = seg === 0 ? 0 : remaining / seg;
      return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
    }
    remaining -= seg;
  }
  return path[path.length - 1]!;
}

/** Douglas–Peucker com tolerância em metros. Mantém primeiro e último pontos. */
export function simplifyPath(path: LatLng[], toleranceMeters: number): LatLng[] {
  if (path.length <= 2) return path.slice();
  const keep = new Uint8Array(path.length);
  keep[0] = 1;
  keep[path.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, path.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let maxDist = 0;
    let index = -1;
    const seg = [path[start]!, path[end]!];
    for (let i = start + 1; i < end; i++) {
      const proj = projectOntoPath(path[i]!, seg);
      const d = proj ? proj.lateral : 0;
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (index !== -1 && maxDist > toleranceMeters) {
      keep[index] = 1;
      stack.push([start, index], [index, end]);
    }
  }
  return path.filter((_, i) => keep[i] === 1);
}

export function boundsOf(points: LatLng[]): Bounds | undefined {
  if (points.length === 0) return undefined;
  let north = -90;
  let south = 90;
  let east = -180;
  let west = 180;
  for (const p of points) {
    north = Math.max(north, p.lat);
    south = Math.min(south, p.lat);
    east = Math.max(east, p.lng);
    west = Math.min(west, p.lng);
  }
  return { north, south, east, west };
}

export function expandBounds(b: Bounds, meters: number): Bounds {
  const dLat = meters / 111_320;
  const midLat = toRad((b.north + b.south) / 2);
  const dLng = meters / (111_320 * Math.max(0.01, Math.cos(midLat)));
  return { north: b.north + dLat, south: b.south - dLat, east: b.east + dLng, west: b.west - dLng };
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return !(a.west > b.east || a.east < b.west || a.south > b.north || a.north < b.south);
}

/**
 * Pontos intermediários do arco de grande círculo entre a e b (inclui extremos).
 * Usado apenas para a REPRESENTAÇÃO cartográfica do trecho aéreo.
 */
export function greatCirclePoints(a: LatLng, b: LatLng, segments = 64): LatLng[] {
  const φ1 = toRad(a.lat);
  const λ1 = toRad(a.lng);
  const φ2 = toRad(b.lat);
  const λ2 = toRad(b.lng);
  const δ = haversineMeters(a, b) / EARTH_RADIUS_M;
  if (δ === 0) return [a, b];
  const out: LatLng[] = [];
  for (let i = 0; i <= segments; i++) {
    const f = i / segments;
    const A = Math.sin((1 - f) * δ) / Math.sin(δ);
    const B = Math.sin(f * δ) / Math.sin(δ);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    out.push({ lat: toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))), lng: toDeg(Math.atan2(y, x)) });
  }
  return out;
}
