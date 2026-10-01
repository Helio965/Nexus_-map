import type {
  ApiErrorBody,
  ApiErrorCode,
  AutocompleteResponse,
  Capabilities,
  DemoSignalResponse,
  FlightRouteRequest,
  LatLng,
  ModeResult,
  PlaceSummary,
  RouteRequest,
  SignalLayerResponse,
  SignalStateSnapshot,
  TravelMode,
} from '@nexus/shared';
import { config } from '../config';

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode | 'NETWORK',
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function isAbort(err: unknown): boolean {
  return err instanceof DOMException
    ? err.name === 'AbortError'
    : (err as Error)?.name === 'AbortError';
}

async function request<T>(
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${config.apiBaseUrl}/api${path}`, {
      method: init.method ?? 'GET',
      headers: init.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
    });
  } catch (err) {
    if (isAbort(err)) throw err;
    throw new ApiError(
      'NETWORK',
      'Não foi possível conectar ao servidor do Nexus Map. Verifique sua conexão.',
      0,
    );
  }
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const body = data as ApiErrorBody | undefined;
    throw new ApiError(
      body?.error?.code ?? 'INTERNAL',
      body?.error?.message ?? `Erro ${res.status} no servidor.`,
      res.status,
    );
  }
  return data as T;
}

export const api = {
  capabilities: (signal?: AbortSignal) => request<Capabilities>('/capabilities', { signal }),

  autocomplete: (q: string, session: string, bias: LatLng | null, signal?: AbortSignal) => {
    const qs = new URLSearchParams({ q, session });
    if (bias) {
      qs.set('lat', bias.lat.toFixed(4));
      qs.set('lng', bias.lng.toFixed(4));
    }
    return request<AutocompleteResponse>(`/places/autocomplete?${qs.toString()}`, { signal });
  },

  placeDetails: (placeId: string, session: string, signal?: AbortSignal) =>
    request<PlaceSummary>(
      `/places/details/${encodeURIComponent(placeId)}?session=${encodeURIComponent(session)}`,
      { signal },
    ),

  reverse: (location: LatLng, signal?: AbortSignal) =>
    request<PlaceSummary>(`/places/reverse?lat=${location.lat}&lng=${location.lng}`, { signal }),

  route: (mode: TravelMode, body: RouteRequest | FlightRouteRequest, signal?: AbortSignal) =>
    request<ModeResult>(`/routes/${mode}`, { method: 'POST', body, signal }),

  signalsAlongRoute: (polyline: string, signal?: AbortSignal) =>
    request<SignalLayerResponse>('/signals/route', { method: 'POST', body: { polyline }, signal }),

  signalStates: (streamIds: string[], signal?: AbortSignal) =>
    request<SignalStateSnapshot>(
      `/signals/state?streams=${encodeURIComponent(streamIds.join(','))}`,
      { signal },
    ),

  signalDemo: (polyline: string, signal?: AbortSignal) =>
    request<DemoSignalResponse>('/signals/demo', { method: 'POST', body: { polyline }, signal }),

  signalStreamUrl: (streamIds: string[]) =>
    `${config.apiBaseUrl}/api/signals/stream?streams=${encodeURIComponent(streamIds.join(','))}`,
};
