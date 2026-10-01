import { isValidTimeZone, type LatLng } from '@nexus/shared';
import { TtlCache } from '../lib/cache';
import type { GoogleTimeZoneClient } from '../providers/google/GoogleLegacyClients';

const DAY_MS = 86_400_000;

/**
 * Resolve o fuso IANA de uma coordenada via Time Zone API (com cache longo:
 * fronteiras de fuso mudam raramente). Retorna undefined quando a API não sabe.
 */
export class TimeZoneService {
  private readonly cache = new TtlCache<string | null>(7 * DAY_MS, 5_000);

  constructor(private readonly client: GoogleTimeZoneClient) {}

  get configured(): boolean {
    return this.client.configured;
  }

  async zoneFor(location: LatLng, signal?: AbortSignal): Promise<string | undefined> {
    // ~1 m de precisão: não mistura lados de uma fronteira de fuso.
    const key = `${location.lat.toFixed(5)},${location.lng.toFixed(5)}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached ?? undefined;
    const res = await this.client.lookup(location, new Date(), signal);
    const zone = res.status === 'OK' && isValidTimeZone(res.timeZoneId) ? res.timeZoneId : null;
    this.cache.set(key, zone);
    return zone ?? undefined;
  }
}
