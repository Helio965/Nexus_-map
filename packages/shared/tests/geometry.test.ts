import { describe, expect, it } from 'vitest';
import {
  bearingDegrees,
  boundsIntersect,
  boundsOf,
  cardinalName,
  decodePolyline,
  encodePolyline,
  greatCirclePoints,
  haversineMeters,
  pathLengthMeters,
  pointAlongPath,
  projectOntoPath,
  simplifyPath,
  travelDirectionLabel,
} from '../src';

const BSB = { lat: -15.869167, lng: -47.920834 }; // SBBR (OurAirports)
const GRU = { lat: -23.431944, lng: -46.469444 }; // SBGR (OurAirports)

describe('geometria', () => {
  it('calcula distância de grande círculo BSB–GRU (~853 km)', () => {
    const d = haversineMeters(BSB, GRU) / 1000;
    expect(d).toBeGreaterThan(845);
    expect(d).toBeLessThan(860);
  });

  it('calcula rumos e nomes cardeais', () => {
    expect(Math.round(bearingDegrees({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }))).toBe(0);
    expect(Math.round(bearingDegrees({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }))).toBe(90);
    expect(cardinalName(181)).toBe('sul');
    expect(travelDirectionLabel(180)).toBe('sentido norte → sul');
    expect(travelDirectionLabel(90)).toBe('sentido oeste → leste');
  });

  it('projeta um ponto num caminho e mede a distância lateral', () => {
    const path = [
      { lat: 53.55, lng: 9.99 },
      { lat: 53.55, lng: 10.0 },
    ];
    const p = projectOntoPath({ lat: 53.5501, lng: 9.995 }, path)!;
    expect(p.lateral).toBeGreaterThan(10);
    expect(p.lateral).toBeLessThan(12);
    expect(p.distanceAlong).toBeCloseTo(pathLengthMeters(path) / 2, -1);
  });

  it('interpola ponto ao longo do caminho', () => {
    const path = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.01 },
    ];
    const mid = pointAlongPath(path, pathLengthMeters(path) / 2)!;
    expect(mid.lng).toBeCloseTo(0.005, 5);
  });

  it('simplifica caminhos mantendo extremos', () => {
    const path = Array.from({ length: 50 }, (_, i) => ({ lat: 0, lng: i * 0.0001 }));
    const simple = simplifyPath(path, 1);
    expect(simple).toHaveLength(2);
    expect(simple[0]).toEqual(path[0]);
    expect(simple[1]).toEqual(path[49]);
  });

  it('codifica e decodifica polilinhas no formato da Routes API', () => {
    // Exemplo oficial do algoritmo de polilinhas do Google.
    const decoded = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(decoded).toEqual([
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ]);
    expect(encodePolyline(decoded)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  });

  it('gera arco de grande círculo com extremos exatos', () => {
    const arc = greatCirclePoints(BSB, GRU, 16);
    expect(arc).toHaveLength(17);
    expect(arc[0]!.lat).toBeCloseTo(BSB.lat, 6);
    expect(arc[16]!.lng).toBeCloseTo(GRU.lng, 6);
  });

  it('calcula e cruza bounds', () => {
    const b = boundsOf([BSB, GRU])!;
    expect(b.north).toBe(BSB.lat);
    expect(b.south).toBe(GRU.lat);
    expect(boundsIntersect(b, { north: -20, south: -21, east: -47, west: -48 })).toBe(true);
    expect(boundsIntersect(b, { north: 54, south: 53, east: 10, west: 9 })).toBe(false);
  });
});
