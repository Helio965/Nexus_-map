import { decode, encode } from '@googlemaps/polyline-codec';
import type { LatLng } from '../types/geo';

/** Decodifica o formato "Encoded Polyline Algorithm" usado pela Routes API. */
export function decodePolyline(encoded: string): LatLng[] {
  if (!encoded) return [];
  return decode(encoded, 5).map(([lat, lng]) => ({ lat, lng }));
}

export function encodePolyline(path: LatLng[]): string {
  return encode(
    path.map((p) => [p.lat, p.lng] as [number, number]),
    5,
  );
}
