import { haversineMeters } from '@nexus/shared';
import { z } from 'zod';

export const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const placeSchema = z.object({
  id: z.string().min(1).max(512).optional(),
  name: z.string().min(1).max(300),
  address: z.string().max(500).optional(),
  location: latLngSchema,
  types: z.array(z.string().max(80)).max(50).default([]),
  primaryType: z.string().max(80).optional(),
  primaryTypeLabel: z.string().max(120).optional(),
  timeZone: z.string().max(64).optional(),
  timeZoneSource: z.enum(['google_places', 'google_time_zone_api', 'device']).optional(),
  source: z.enum(['google_places', 'device_geolocation']),
});

export const timeSchema = z
  .object({
    mode: z.enum(['now', 'depart_at', 'arrive_by']),
    instant: z.iso.datetime({ offset: true }).optional(),
    zone: z.string().max(64).optional(),
  })
  .refine((t) => t.mode === 'now' || !!t.instant, {
    message: 'Informe data e horário para "Sair às" ou "Chegar até".',
    path: ['instant'],
  });

export const routeRequestSchema = z
  .object({
    origin: placeSchema,
    destination: placeSchema,
    time: timeSchema,
  })
  .refine(
    (r) =>
      !(r.origin.id && r.destination.id && r.origin.id === r.destination.id) &&
      haversineMeters(r.origin.location, r.destination.location) > 5,
    { message: 'Origem e destino são o mesmo local.', path: ['destination'] },
  );

export const flightRequestSchema = z
  .object({
    origin: placeSchema,
    destination: placeSchema,
    time: timeSchema,
    preDepartureMarginMinutes: z.number().int().min(0).max(600),
    postArrivalMarginMinutes: z.number().int().min(0).max(300),
  })
  .refine(
    (r) =>
      !(r.origin.id && r.destination.id && r.origin.id === r.destination.id) &&
      haversineMeters(r.origin.location, r.destination.location) > 5,
    { message: 'Origem e destino são o mesmo local.', path: ['destination'] },
  );

export const polylineRequestSchema = z.object({
  polyline: z.string().min(2).max(500_000),
});

const STREAM_ID_RE = /^[a-z_]+:\d+$/;
export const streamIdsSchema = z
  .string()
  .max(10_000)
  .transform((s) => [
    ...new Set(
      s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ])
  .pipe(z.array(z.string().regex(STREAM_ID_RE)).min(1).max(300));

export const autocompleteQuerySchema = z.object({
  q: z.string().max(200),
  session: z.string().max(100).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});

export const reverseQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});
