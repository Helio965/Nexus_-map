import type { LatLng } from './geo';

export type PlaceSource = 'google_places' | 'device_geolocation';
export type TimeZoneSource = 'google_places' | 'google_time_zone_api' | 'device';

/** Local geograficamente validado (sempre vem de um provedor, nunca de texto livre). */
export interface PlaceSummary {
  /** Place ID do Google (ausente para a localização do dispositivo). */
  id?: string;
  name: string;
  address?: string;
  location: LatLng;
  types: string[];
  primaryType?: string;
  primaryTypeLabel?: string;
  /** Fuso IANA, ex.: "America/Sao_Paulo". */
  timeZone?: string;
  timeZoneSource?: TimeZoneSource;
  source: PlaceSource;
}

export interface PlaceSuggestion {
  placeId: string;
  mainText: string;
  secondaryText?: string;
  fullText: string;
  types: string[];
  distanceMeters?: number;
}

export interface AutocompleteResponse {
  suggestions: PlaceSuggestion[];
}
