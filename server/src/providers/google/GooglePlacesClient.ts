import type { GoogleMapsPlatform } from './GoogleMapsPlatform';

export const PLACES_API_NAME = 'Places API (New)';

export interface RawAutocompleteResponse {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
      structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
      types?: string[];
      distanceMeters?: number;
    };
  }>;
}

export interface RawPlaceDetails {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  types?: string[];
  primaryType?: string;
  primaryTypeDisplayName?: { text?: string };
  timeZone?: { id?: string };
}

const AUTOCOMPLETE_MASK = [
  'suggestions.placePrediction.placeId',
  'suggestions.placePrediction.text.text',
  'suggestions.placePrediction.structuredFormat',
  'suggestions.placePrediction.types',
  'suggestions.placePrediction.distanceMeters',
].join(',');

/** Essentials + Pro (displayName, primaryType*, timeZone). */
const DETAILS_MASK =
  'id,displayName,formattedAddress,location,types,primaryType,primaryTypeDisplayName,timeZone';

export class GooglePlacesClient {
  constructor(
    private readonly platform: GoogleMapsPlatform,
    private readonly languageCode: string,
    private readonly regionCode: string,
  ) {}

  autocomplete(
    input: string,
    opts: { sessionToken?: string; bias?: { lat: number; lng: number; radiusMeters: number } },
    signal?: AbortSignal,
  ): Promise<RawAutocompleteResponse> {
    const body: Record<string, unknown> = {
      input,
      languageCode: this.languageCode,
      regionCode: this.regionCode,
    };
    if (opts.sessionToken) body.sessionToken = opts.sessionToken;
    if (opts.bias) {
      const center = { latitude: opts.bias.lat, longitude: opts.bias.lng };
      body.locationBias = { circle: { center, radius: opts.bias.radiusMeters } };
      body.origin = center;
    }
    return this.platform.callWithFieldMask<RawAutocompleteResponse>(
      PLACES_API_NAME,
      'https://places.googleapis.com/v1/places:autocomplete',
      { method: 'POST', body, fieldMask: AUTOCOMPLETE_MASK, signal, timeoutMs: 8_000 },
    );
  }

  details(
    placeId: string,
    sessionToken: string | undefined,
    signal?: AbortSignal,
  ): Promise<RawPlaceDetails> {
    const qs = new URLSearchParams({
      languageCode: this.languageCode,
      regionCode: this.regionCode,
    });
    if (sessionToken) qs.set('sessionToken', sessionToken);
    return this.platform.callWithFieldMask<RawPlaceDetails>(
      PLACES_API_NAME,
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?${qs.toString()}`,
      { method: 'GET', fieldMask: DETAILS_MASK, signal, timeoutMs: 8_000 },
    );
  }
}
