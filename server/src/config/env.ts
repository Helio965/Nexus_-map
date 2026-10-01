import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';

const boolFromString = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v === undefined || v.trim() === ''
        ? def
        : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()),
    );

const intFromString = (def: number, min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? def : Number(v)))
    .pipe(z.number().int().min(min).max(max));

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const EnvSchema = z.object({
  NODE_ENV: z.string().optional().default('development'),
  PORT: intFromString(8787, 1, 65535),
  CORS_ORIGIN: optionalString,

  GOOGLE_MAPS_SERVER_KEY: optionalString,
  GOOGLE_LANGUAGE_CODE: z.string().optional().default('pt-BR'),
  GOOGLE_REGION_CODE: z.string().optional().default('BR'),
  ROUTES_TRAFFIC_ON_POLYLINE: boolFromString(true),
  ROUTES_TOLLS: boolFromString(true),

  FLIGHTAWARE_AEROAPI_KEY: optionalString,
  AEROAPI_BASE_URL: z.string().optional().default('https://aeroapi.flightaware.com/aeroapi'),
  AEROAPI_MAX_REQUESTS_PER_MINUTE: intFromString(10, 1, 6000),
  FLIGHT_MIN_DISTANCE_KM: intFromString(100, 0, 20000),
  FLIGHT_AIRPORT_SEARCH_RADIUS_KM: intFromString(120, 5, 1000),
  FLIGHT_MAX_AIRPORTS_PER_SIDE: intFromString(2, 1, 5),
  FLIGHT_MAX_OPTIONS: intFromString(3, 1, 5),
  AIRPORTS_DATA_URL: z
    .string()
    .optional()
    .default('https://davidmegginson.github.io/ourairports-data/airports.csv'),
  AIRPORTS_CACHE_DIR: z.string().optional().default('.cache'),

  SIGNALS_OSM_ENABLED: boolFromString(true),
  OVERPASS_API_URL: z.string().optional().default('https://overpass-api.de/api/interpreter'),
  SIGNALS_HAMBURG_TLD_ENABLED: boolFromString(true),
  HAMBURG_TLD_BASE_URL: z.string().optional().default('https://tld.iot.hamburg.de/v1.1'),
  HAMBURG_TLD_MQTT_URL: z.string().optional().default('wss://tld.iot.hamburg.de:443/mqtt'),
  SIGNALS_MAX_ROUTE_KM: intFromString(60, 1, 1000),
  SIGNALS_STALE_AFTER_SECONDS: intFromString(300, 10, 86400),
  TRAFFIC_SIGNAL_DEMO_MODE: boolFromString(false),

  HTTPS_PROXY: optionalString,
});

export type Env = z.output<typeof EnvSchema>;

/** Carrega o .env da raiz do monorepo (se existir) sem sobrescrever variáveis já definidas. */
export function loadDotEnv(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // cwd → raiz do monorepo a partir de server/dist (../../) → a partir de server/src/config (../../../)
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(here, '../../.env'),
    path.resolve(here, '../../../.env'),
  ];
  for (const file of candidates) {
    if (existsSync(file)) {
      process.loadEnvFile(file);
      return;
    }
  }
}

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuração inválida: ${issues}`);
  }
  return parsed.data;
}
