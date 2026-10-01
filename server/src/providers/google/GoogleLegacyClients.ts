import type { LatLng } from '@nexus/shared';
import type { GoogleMapsPlatform } from './GoogleMapsPlatform';

export const TIME_ZONE_API_NAME = 'Time Zone API';
export const GEOCODING_API_NAME = 'Geocoding API';

export interface RawTimeZoneResponse {
  status?: string;
  timeZoneId?: string;
  timeZoneName?: string;
  rawOffset?: number;
  dstOffset?: number;
  errorMessage?: string;
}

export interface RawGeocodeResponse {
  status?: string;
  error_message?: string;
  results?: Array<{ place_id?: string; formatted_address?: string; types?: string[] }>;
}

export class GoogleTimeZoneClient {
  constructor(private readonly platform: GoogleMapsPlatform) {}

  get configured(): boolean {
    return this.platform.configured;
  }

  lookup(location: LatLng, at: Date, signal?: AbortSignal): Promise<RawTimeZoneResponse> {
    return this.platform.callLegacy<RawTimeZoneResponse>(
      TIME_ZONE_API_NAME,
      'https://maps.googleapis.com/maps/api/timezone/json',
      { location: `${location.lat},${location.lng}`, timestamp: String(Math.floor(at.getTime() / 1000)) },
      signal,
    );
  }
}

export class GoogleGeocodingClient {
  constructor(
    private readonly platform: GoogleMapsPlatform,
    private readonly languageCode: string,
  ) {}

  reverse(location: LatLng, signal?: AbortSignal): Promise<RawGeocodeResponse> {
    return this.platform.callLegacy<RawGeocodeResponse>(
      GEOCODING_API_NAME,
      'https://maps.googleapis.com/maps/api/geocode/json',
      { latlng: `${location.lat},${location.lng}`, language: this.languageCode },
      signal,
    );
  }
}
