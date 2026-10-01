/**
 * Subconjunto tipado da resposta de `computeRoutes` (Routes API v2) usado pela aplicação.
 * Referência: https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRoutes
 * Todos os campos são opcionais: a API omite campos fora da field mask e valores padrão (proto3).
 */

export interface RawLatLng {
  latitude?: number;
  longitude?: number;
}

export interface RawLocation {
  latLng?: RawLatLng;
}

export interface RawSpeedReadingInterval {
  startPolylinePointIndex?: number;
  endPolylinePointIndex?: number;
  speed?: 'SPEED_UNSPECIFIED' | 'NORMAL' | 'SLOW' | 'TRAFFIC_JAM';
}

export interface RawMoney {
  currencyCode?: string;
  units?: string;
  nanos?: number;
}

export interface RawTransitStop {
  name?: string;
  location?: RawLocation;
}

export interface RawLocalizedTime {
  time?: { text?: string };
  timeZone?: string;
}

export interface RawTransitDetails {
  stopDetails?: {
    arrivalStop?: RawTransitStop;
    arrivalTime?: string;
    departureStop?: RawTransitStop;
    departureTime?: string;
  };
  localizedValues?: {
    arrivalTime?: RawLocalizedTime;
    departureTime?: RawLocalizedTime;
  };
  headsign?: string;
  headway?: string;
  transitLine?: {
    agencies?: { name?: string; uri?: string }[];
    name?: string;
    uri?: string;
    color?: string;
    iconUri?: string;
    nameShort?: string;
    textColor?: string;
    vehicle?: { name?: { text?: string }; type?: string; iconUri?: string; localIconUri?: string };
  };
  stopCount?: number;
  tripShortText?: string;
}

export interface RawStep {
  distanceMeters?: number;
  staticDuration?: string;
  polyline?: { encodedPolyline?: string };
  startLocation?: RawLocation;
  endLocation?: RawLocation;
  navigationInstruction?: { maneuver?: string; instructions?: string };
  travelMode?: string;
  transitDetails?: RawTransitDetails;
}

export interface RawLeg {
  distanceMeters?: number;
  duration?: string;
  staticDuration?: string;
  steps?: RawStep[];
}

export interface RawRoute {
  routeLabels?: string[];
  distanceMeters?: number;
  duration?: string;
  staticDuration?: string;
  polyline?: { encodedPolyline?: string };
  description?: string;
  warnings?: string[];
  viewport?: { low?: RawLatLng; high?: RawLatLng };
  travelAdvisory?: {
    speedReadingIntervals?: RawSpeedReadingInterval[];
    tollInfo?: { estimatedPrice?: RawMoney[] };
    transitFare?: RawMoney;
  };
  legs?: RawLeg[];
}

export interface RawComputeRoutesResponse {
  routes?: RawRoute[];
  geocodingResults?: { origin?: RawGeocodedWaypoint; destination?: RawGeocodedWaypoint };
  fallbackInfo?: {
    routingMode?:
      'FALLBACK_ROUTING_MODE_UNSPECIFIED' | 'FALLBACK_TRAFFIC_UNAWARE' | 'FALLBACK_TRAFFIC_AWARE';
    reason?: 'FALLBACK_REASON_UNSPECIFIED' | 'SERVER_ERROR' | 'LATENCY_EXCEEDED';
  };
}

export type RawWaypoint =
  | { placeId: string }
  | { address: string }
  | { location: { latLng: { latitude: number; longitude: number } } };

export interface RawGeocodedWaypoint {
  geocoderStatus?: { code?: number; message?: string };
  type?: string[];
  partialMatch?: boolean;
  placeId?: string;
}

export interface ComputeRoutesBody {
  origin: RawWaypoint;
  destination: RawWaypoint;
  travelMode: 'DRIVE' | 'WALK' | 'TRANSIT';
  routingPreference?: 'TRAFFIC_UNAWARE' | 'TRAFFIC_AWARE' | 'TRAFFIC_AWARE_OPTIMAL';
  polylineQuality?: 'HIGH_QUALITY' | 'OVERVIEW';
  departureTime?: string;
  arrivalTime?: string;
  computeAlternativeRoutes?: boolean;
  extraComputations?: Array<'TOLLS' | 'TRAFFIC_ON_POLYLINE'>;
  languageCode?: string;
  regionCode?: string;
  units?: 'METRIC' | 'IMPERIAL';
  transitPreferences?: {
    allowedTravelModes?: Array<'BUS' | 'SUBWAY' | 'TRAIN' | 'LIGHT_RAIL' | 'RAIL'>;
    routingPreference?: 'LESS_WALKING' | 'FEWER_TRANSFERS';
  };
}
