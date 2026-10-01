import type { GoogleMapsPlatform } from './GoogleMapsPlatform';
import type { ComputeRoutesBody, RawComputeRoutesResponse } from './routesTypes';

export const ROUTES_API_NAME = 'Routes API';
const COMPUTE_ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

/** Field masks: pedimos somente o que a interface usa (latência e custo menores). */
export const FIELD_MASKS = {
  /** Estimativa de duração (iterações do "chegar até", trajetos até aeroportos). */
  durationOnly: 'routes.duration,routes.staticDuration,routes.distanceMeters',
  drive: [
    'routes.routeLabels',
    'routes.distanceMeters',
    'routes.duration',
    'routes.staticDuration',
    'routes.polyline.encodedPolyline',
    'routes.description',
    'routes.warnings',
    'routes.viewport',
    'routes.travelAdvisory.speedReadingIntervals',
    'routes.travelAdvisory.tollInfo',
    'routes.legs.steps.distanceMeters',
    'routes.legs.steps.staticDuration',
    'routes.legs.steps.navigationInstruction',
    'routes.legs.steps.startLocation',
    'fallbackInfo',
  ].join(','),
  walk: [
    'routes.routeLabels',
    'routes.distanceMeters',
    'routes.duration',
    'routes.staticDuration',
    'routes.polyline.encodedPolyline',
    'routes.description',
    'routes.warnings',
    'routes.viewport',
    'routes.legs.steps.distanceMeters',
    'routes.legs.steps.staticDuration',
    'routes.legs.steps.navigationInstruction',
    'routes.legs.steps.startLocation',
  ].join(','),
  /** Trechos de carro em viagens multimodais: polilinha + passos, sem extras Enterprise. */
  leg: [
    'routes.distanceMeters',
    'routes.duration',
    'routes.staticDuration',
    'routes.polyline.encodedPolyline',
    'routes.legs.steps.distanceMeters',
    'routes.legs.steps.staticDuration',
    'routes.legs.steps.navigationInstruction',
    'routes.legs.steps.startLocation',
  ].join(','),
  transit: [
    'routes.routeLabels',
    'routes.distanceMeters',
    'routes.duration',
    'routes.staticDuration',
    'routes.polyline.encodedPolyline',
    'routes.warnings',
    'routes.viewport',
    'routes.travelAdvisory.transitFare',
    'routes.legs.steps.distanceMeters',
    'routes.legs.steps.staticDuration',
    'routes.legs.steps.polyline.encodedPolyline',
    'routes.legs.steps.navigationInstruction',
    'routes.legs.steps.startLocation',
    'routes.legs.steps.travelMode',
    'routes.legs.steps.transitDetails',
  ].join(','),
} as const;

export class GoogleRoutesClient {
  constructor(private readonly platform: GoogleMapsPlatform) {}

  get configured(): boolean {
    return this.platform.configured;
  }

  computeRoutes(
    body: ComputeRoutesBody,
    fieldMask: string,
    signal?: AbortSignal,
  ): Promise<RawComputeRoutesResponse> {
    return this.platform.callWithFieldMask<RawComputeRoutesResponse>(
      ROUTES_API_NAME,
      COMPUTE_ROUTES_URL,
      {
        method: 'POST',
        body,
        fieldMask,
        signal,
        timeoutMs: 25_000,
      },
    );
  }
}
