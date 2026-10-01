export type ApiErrorCode =
  | 'VALIDATION'
  | 'NOT_CONFIGURED'
  | 'NOT_FOUND'
  | 'UPSTREAM'
  | 'UPSTREAM_TIMEOUT'
  | 'QUOTA'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
}

/** O que está configurado no servidor (sem expor segredos). */
export interface Capabilities {
  google: { serverKeyConfigured: boolean };
  routes: { trafficOnPolyline: boolean; tolls: boolean };
  flights: {
    configured: boolean;
    provider: string | null;
    minDistanceKm: number;
    airportSearchRadiusKm: number;
  };
  signals: {
    osm: boolean;
    hamburgTld: boolean;
    demoMode: boolean;
    maxRouteKm: number;
  };
}
