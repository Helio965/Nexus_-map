import { isValidTimeZone, type LatLng, type PlaceSuggestion, type PlaceSummary } from '@nexus/shared';
import { TtlCache, cacheKey } from '../lib/cache';
import { AppError } from '../lib/errors';
import type { GoogleGeocodingClient } from '../providers/google/GoogleLegacyClients';
import type { GooglePlacesClient } from '../providers/google/GooglePlacesClient';
import type { TimeZoneService } from './TimeZoneService';

/**
 * Busca de lugares com validação geográfica: todo local usado em rotas vem de um
 * Place ID resolvido pela Places API (New) ou da geolocalização do dispositivo.
 */
export class PlacesService {
  /** Evita repetir a mesma consulta de autocomplete (ex.: usuário apaga e redigita). */
  private readonly autocompleteCache = new TtlCache<PlaceSuggestion[]>(5 * 60_000, 1_000);

  constructor(
    private readonly places: GooglePlacesClient,
    private readonly geocoding: GoogleGeocodingClient,
    private readonly timeZones: TimeZoneService,
  ) {}

  async autocomplete(
    input: string,
    opts: { sessionToken?: string; bias?: LatLng },
    signal?: AbortSignal,
  ): Promise<PlaceSuggestion[]> {
    const trimmed = input.trim();
    if (trimmed.length < 3) return [];
    const key = cacheKey([trimmed.toLowerCase(), opts.bias?.lat.toFixed(2), opts.bias?.lng.toFixed(2)]);
    const cached = this.autocompleteCache.get(key);
    if (cached) return cached;

    const res = await this.places.autocomplete(
      trimmed,
      {
        sessionToken: opts.sessionToken,
        bias: opts.bias ? { ...opts.bias, radiusMeters: 50_000 } : undefined,
      },
      signal,
    );
    const suggestions: PlaceSuggestion[] = [];
    for (const s of res.suggestions ?? []) {
      const p = s.placePrediction;
      if (!p?.placeId) continue; // previsões de consulta (sem Place ID) não são locais validados
      suggestions.push({
        placeId: p.placeId,
        mainText: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
        secondaryText: p.structuredFormat?.secondaryText?.text,
        fullText: p.text?.text ?? p.structuredFormat?.mainText?.text ?? '',
        types: p.types ?? [],
        distanceMeters: p.distanceMeters,
      });
    }
    this.autocompleteCache.set(key, suggestions);
    return suggestions;
  }

  async details(placeId: string, sessionToken: string | undefined, signal?: AbortSignal): Promise<PlaceSummary> {
    const raw = await this.places.details(placeId, sessionToken, signal);
    const lat = raw.location?.latitude;
    const lng = raw.location?.longitude;
    if (!raw.id || lat === undefined || lng === undefined) {
      throw new AppError('NOT_FOUND', 'Não foi possível localizar esse endereço.');
    }
    const place: PlaceSummary = {
      id: raw.id,
      name: raw.displayName?.text ?? raw.formattedAddress ?? 'Local sem nome',
      address: raw.formattedAddress,
      location: { lat, lng },
      types: raw.types ?? [],
      primaryType: raw.primaryType,
      primaryTypeLabel: raw.primaryTypeDisplayName?.text,
      source: 'google_places',
    };
    if (isValidTimeZone(raw.timeZone?.id)) {
      place.timeZone = raw.timeZone.id;
      place.timeZoneSource = 'google_places';
    } else {
      await this.fillTimeZone(place, signal);
    }
    return place;
  }

  /** "Utilizar minha localização": coordenada do navegador → endereço real (Geocoding reverso). */
  async reverse(location: LatLng, signal?: AbortSignal): Promise<PlaceSummary> {
    const res = await this.geocoding.reverse(location, signal);
    const first = res.results?.[0];
    const place: PlaceSummary = {
      name: 'Minha localização',
      address: first?.formatted_address,
      location,
      types: first?.types ?? [],
      source: 'device_geolocation',
    };
    await this.fillTimeZone(place, signal);
    return place;
  }

  private async fillTimeZone(place: PlaceSummary, signal?: AbortSignal): Promise<void> {
    try {
      const zone = await this.timeZones.zoneFor(place.location, signal);
      if (zone) {
        place.timeZone = zone;
        place.timeZoneSource = 'google_time_zone_api';
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      // Sem fuso: o cliente avisa e usa o fuso do dispositivo somente para a localização do próprio
      // dispositivo. Nenhum fuso é inventado aqui.
      console.warn('[places] fuso indisponível:', (err as Error).message);
    }
  }
}
