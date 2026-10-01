import type { Bounds, LatLng } from './geo';
import type { PlaceSummary } from './places';
import type { ResolvedTimeRequest, TimePoint } from './time';

export type TravelMode = 'drive' | 'walk' | 'rail' | 'flight';

export const TRAVEL_MODES: readonly TravelMode[] = ['drive', 'walk', 'rail', 'flight'];

/**
 * available      — há pelo menos uma opção real.
 * unavailable    — o provedor respondeu, mas não há opção real (ex.: sem metrô no trajeto).
 * not_configured — falta credencial/provedor; nada foi consultado.
 * error          — falha ao consultar o provedor (não é "sem rota").
 */
export type ModeStatus = 'available' | 'unavailable' | 'not_configured' | 'error';

/**
 * live      — "● Ao vivo": condição atual informada pelo provedor.
 * predicted — "◷ Previsão": previsão/histórico ou horário programado.
 * static    — "○ Informação do mapa": dado estático.
 * none      — "— Sem dados".
 */
export type DataFreshness = 'live' | 'predicted' | 'static' | 'none';

/** Categorias exatas da Routes API (SpeedReadingInterval.speed). */
export type TrafficSpeed = 'NORMAL' | 'SLOW' | 'TRAFFIC_JAM';

/** Índices na polilinha decodificada do segmento (start inclusivo, end inclusivo). */
export interface TrafficInterval {
  start: number;
  end: number;
  speed: TrafficSpeed;
}

export interface NavigationStep {
  /** Texto do mecanismo de navegação (nunca gerado pela aplicação). */
  instruction: string;
  maneuver?: string;
  distanceMeters?: number;
  durationSeconds?: number;
  startLocation?: LatLng;
}

export interface MoneyAmount {
  currencyCode: string;
  amount: number;
}

export interface TollInfo {
  /** true = a API informou pedágio no trajeto. */
  present: boolean;
  estimatedPrices: MoneyAmount[];
}

export interface StopInfo {
  name: string;
  location?: LatLng;
}

export interface TransitLineInfo {
  name?: string;
  shortName?: string;
  color?: string;
  textColor?: string;
  /** TransitVehicle.type da Routes API (SUBWAY, HEAVY_RAIL, TRAM, BUS…). */
  vehicleType: string;
  vehicleName?: string;
  agencies: string[];
  iconUri?: string;
}

export interface AirportInfo {
  iata: string;
  icao?: string;
  name: string;
  municipality?: string;
  countryCode: string;
  location: LatLng;
  timeZone?: string;
  distanceFromPlaceKm?: number;
}

export interface FlightInfo {
  /** Identificador comercial exibido (ex.: "LA3215"). */
  ident: string;
  identIata?: string;
  /** Voo do operador real quando `ident` é codeshare. */
  operatorIdent?: string;
  aircraftType?: string;
  /** Horário de saída do gate (UTC) publicado pela companhia. */
  scheduledOut: string;
  /** Horário de chegada ao gate (UTC) publicado pela companhia. */
  scheduledIn: string;
  isCodeshare: boolean;
  provider: string;
}

export interface GroundSegment {
  kind: 'drive' | 'walk';
  polyline: string;
  distanceMeters: number;
  durationSeconds: number;
  staticDurationSeconds?: number;
  steps: NavigationStep[];
  traffic?: TrafficInterval[];
  departure?: TimePoint;
  arrival?: TimePoint;
  label?: string;
}

export interface TransitSegment {
  kind: 'transit';
  polyline?: string;
  distanceMeters?: number;
  durationSeconds: number;
  line: TransitLineInfo;
  departureStop: StopInfo;
  arrivalStop: StopInfo;
  departure: TimePoint;
  arrival: TimePoint;
  /** Sentido/destino exibido no veículo. */
  headsign?: string;
  /** Paradas entre embarque (exclusiva) e desembarque (inclusiva), conforme a API. */
  stopCount?: number;
  tripShortText?: string;
  headwaySeconds?: number;
}

export interface FlightSegment {
  kind: 'flight';
  durationSeconds: number;
  flight: FlightInfo;
  from: AirportInfo;
  to: AirportInfo;
  departure: TimePoint;
  arrival: TimePoint;
}

/** Margem de tempo escolhida pelo usuário (ex.: antecedência no aeroporto). */
export interface BufferSegment {
  kind: 'buffer';
  durationSeconds: number;
  label: string;
  userDefined: true;
}

export type Segment = GroundSegment | TransitSegment | FlightSegment | BufferSegment;

export interface RouteOption {
  id: string;
  mode: TravelMode;
  summary?: string;
  departure: TimePoint;
  arrival: TimePoint;
  /** Duração porta a porta (com trânsito quando o provedor o considera). */
  durationSeconds: number;
  /** Duração sem considerar trânsito (Routes API staticDuration). */
  staticDurationSeconds?: number;
  distanceMeters?: number;
  transfers?: number;
  traffic: {
    freshness: DataFreshness;
    /** duration − staticDuration, somente quando ambos vieram da API. */
    delaySeconds?: number;
    note?: string;
  };
  tolls?: TollInfo;
  segments: Segment[];
  bounds?: Bounds;
  warnings: string[];
  isDefault?: boolean;
  /** Explica como os horários foram obtidos (ex.: iteração do "chegar até"). */
  scheduleNote?: string;
}

export interface ModeResult {
  mode: TravelMode;
  status: ModeStatus;
  /** Mensagem para o usuário quando não há opção ou houve erro. */
  message?: string;
  options: RouteOption[];
  warnings: string[];
  provider: string;
  timing?: {
    requested: ResolvedTimeRequest;
    method: string;
    apiCalls: number;
  };
  /** Informações auxiliares (ex.: aeroportos considerados). */
  meta?: FlightSearchMeta;
}

export interface FlightSearchMeta {
  originAirports: AirportInfo[];
  destinationAirports: AirportInfo[];
  flightsFound: number;
  preDepartureMarginMinutes: number;
  postArrivalMarginMinutes: number;
  directFlightsOnly: true;
}

export interface RouteRequest {
  origin: PlaceSummary;
  destination: PlaceSummary;
  time: ResolvedTimeRequest;
}

export interface FlightRouteRequest extends RouteRequest {
  /** Margem definida pelo usuário entre chegar ao aeroporto e a partida do voo. */
  preDepartureMarginMinutes: number;
  /** Margem definida pelo usuário entre o pouso e sair do aeroporto. */
  postArrivalMarginMinutes: number;
}
