import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { haversineMeters, type LatLng } from '@nexus/shared';
import { parseCsv } from '../../lib/csv';
import { AppError } from '../../lib/errors';
import type { FetchFn } from '../../lib/http';

export type AirportSize = 'large_airport' | 'medium_airport';

export interface AirportRecord {
  iata: string;
  icao?: string;
  name: string;
  municipality?: string;
  countryCode: string;
  location: LatLng;
  size: AirportSize;
}

export interface NearbyAirport extends AirportRecord {
  distanceKm: number;
}

export const OURAIRPORTS_ATTRIBUTION = 'OurAirports (domínio público) — https://ourairports.com/data/';

/**
 * Extrai do airports.csv do OurAirports somente aeroportos reais com voos regulares:
 * type ∈ {large_airport, medium_airport}, scheduled_service = "yes" e código IATA válido.
 */
export function parseOurAirportsCsv(text: string): AirportRecord[] {
  const rows = parseCsv(text);
  const header = rows[0];
  if (!header) return [];
  const col = (name: string) => header.indexOf(name);
  const idx = {
    type: col('type'),
    name: col('name'),
    lat: col('latitude_deg'),
    lng: col('longitude_deg'),
    country: col('iso_country'),
    municipality: col('municipality'),
    scheduled: col('scheduled_service'),
    icao: col('icao_code'),
    gps: col('gps_code'),
    iata: col('iata_code'),
  };
  if (Object.values(idx).some((i) => i < 0 && i !== idx.icao && i !== idx.gps)) {
    throw new Error('Formato inesperado do airports.csv (colunas ausentes).');
  }
  const out: AirportRecord[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!;
    const type = row[idx.type];
    if (type !== 'large_airport' && type !== 'medium_airport') continue;
    if (row[idx.scheduled] !== 'yes') continue;
    const iata = (row[idx.iata] ?? '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(iata)) continue;
    const lat = Number(row[idx.lat]);
    const lng = Number(row[idx.lng]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const icao = ((idx.icao >= 0 ? row[idx.icao] : '') || (idx.gps >= 0 ? row[idx.gps] : '') || '').trim();
    out.push({
      iata,
      icao: /^[A-Z0-9]{4}$/.test(icao) ? icao : undefined,
      name: row[idx.name] ?? iata,
      municipality: row[idx.municipality] || undefined,
      countryCode: row[idx.country] ?? '',
      location: { lat, lng },
      size: type,
    });
  }
  return out;
}

/**
 * Seleciona aeroportos dentro do raio. Ordena por distância; se nenhum dos escolhidos for de
 * grande porte e houver um no raio, o mais próximo de grande porte entra no lugar do último
 * (hubs concentram a oferta de voos diretos).
 */
export function selectNearbyAirports(
  airports: AirportRecord[],
  location: LatLng,
  radiusKm: number,
  limit: number,
): NearbyAirport[] {
  const within = airports
    .map((a) => ({ ...a, distanceKm: haversineMeters(location, a.location) / 1000 }))
    .filter((a) => a.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
  const picked = within.slice(0, limit);
  if (picked.length > 0 && !picked.some((a) => a.size === 'large_airport')) {
    const large = within.find((a) => a.size === 'large_airport');
    if (large) picked[picked.length - 1] = large;
  }
  return picked;
}

export interface AirportDirectoryOptions {
  dataUrl: string;
  cacheDir: string;
  fetchFn?: FetchFn;
  maxAgeMs?: number;
}

export class AirportDirectory {
  private airports: AirportRecord[] | null = null;
  private loading: Promise<AirportRecord[]> | null = null;

  constructor(private readonly opts: AirportDirectoryOptions) {}

  /** Para testes: injeta registros já carregados. */
  static fromRecords(records: AirportRecord[]): AirportDirectory {
    const dir = new AirportDirectory({ dataUrl: '', cacheDir: '' });
    dir.airports = records;
    return dir;
  }

  async nearest(location: LatLng, radiusKm: number, limit: number): Promise<NearbyAirport[]> {
    const all = await this.load();
    return selectNearbyAirports(all, location, radiusKm, limit);
  }

  load(): Promise<AirportRecord[]> {
    if (this.airports) return Promise.resolve(this.airports);
    if (!this.loading) {
      this.loading = this.loadFromCacheOrNetwork()
        .then((list) => {
          this.airports = list;
          return list;
        })
        .finally(() => {
          this.loading = null;
        });
    }
    return this.loading;
  }

  private async loadFromCacheOrNetwork(): Promise<AirportRecord[]> {
    const file = path.resolve(this.opts.cacheDir, 'ourairports-airports.csv');
    const maxAge = this.opts.maxAgeMs ?? 7 * 86_400_000;
    let cachedText: string | null = null;
    try {
      const info = await stat(file);
      cachedText = await readFile(file, 'utf8');
      if (Date.now() - info.mtimeMs < maxAge) return parseOurAirportsCsv(cachedText);
    } catch {
      // sem cache local
    }
    try {
      const fetchFn = this.opts.fetchFn ?? fetch;
      const res = await fetchFn(this.opts.dataUrl, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const parsed = parseOurAirportsCsv(text);
      if (parsed.length === 0) throw new Error('arquivo sem aeroportos');
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, text, 'utf8');
      return parsed;
    } catch (err) {
      if (cachedText) {
        console.warn('[airports] usando cache antigo; atualização falhou:', (err as Error).message);
        return parseOurAirportsCsv(cachedText);
      }
      throw new AppError('UPSTREAM', 'Base de aeroportos (OurAirports) indisponível no momento.', {
        provider: 'OurAirports',
        cause: err,
      });
    }
  }
}
