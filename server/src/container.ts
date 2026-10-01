import type { Capabilities } from '@nexus/shared';
import type { Env } from './config/env';
import type { FetchFn } from './lib/http';
import { AirportDirectory } from './providers/airports/AirportDirectory';
import { AeroApiFlightProvider } from './providers/flights/AeroApiFlightProvider';
import { UnconfiguredFlightProvider, type FlightProvider } from './providers/flights/FlightProvider';
import { GoogleGeocodingClient, GoogleTimeZoneClient } from './providers/google/GoogleLegacyClients';
import { GoogleMapsPlatform } from './providers/google/GoogleMapsPlatform';
import { GooglePlacesClient } from './providers/google/GooglePlacesClient';
import { GoogleRoutesClient } from './providers/google/GoogleRoutesClient';
import { DemoTrafficSignalProvider } from './providers/signals/demo/DemoTrafficSignalProvider';
import { HamburgMqttBridge } from './providers/signals/hamburg/HamburgMqttBridge';
import { HamburgTldProvider } from './providers/signals/hamburg/HamburgTldProvider';
import { OsmTrafficSignalLocator } from './providers/signals/OsmTrafficSignalLocator';
import type { SignalLocationSource, TrafficSignalProvider } from './providers/signals/TrafficSignalProvider';
import { FlightService } from './services/FlightService';
import { PlacesService } from './services/PlacesService';
import { RouteService } from './services/RouteService';
import { TimeZoneService } from './services/TimeZoneService';
import { TrafficSignalService } from './services/TrafficSignalService';
import { GoogleTransitService, type TransitProvider } from './services/TransitService';

export interface Services {
  places: PlacesService;
  routes: RouteService;
  transit: TransitProvider;
  flights: FlightService;
  signals: TrafficSignalService;
  capabilities: Capabilities;
  airports: AirportDirectory;
  shutdown: () => void;
}

export function createServices(env: Env, fetchFn: FetchFn = fetch): Services {
  const platform = new GoogleMapsPlatform(env.GOOGLE_MAPS_SERVER_KEY, fetchFn);
  const routesClient = new GoogleRoutesClient(platform);
  const timeZones = new TimeZoneService(new GoogleTimeZoneClient(platform));
  const places = new PlacesService(
    new GooglePlacesClient(platform, env.GOOGLE_LANGUAGE_CODE, env.GOOGLE_REGION_CODE),
    new GoogleGeocodingClient(platform, env.GOOGLE_LANGUAGE_CODE),
    timeZones,
  );
  const routes = new RouteService(routesClient, {
    languageCode: env.GOOGLE_LANGUAGE_CODE,
    regionCode: env.GOOGLE_REGION_CODE,
    trafficOnPolyline: env.ROUTES_TRAFFIC_ON_POLYLINE,
    tolls: env.ROUTES_TOLLS,
  });
  const transit = new GoogleTransitService(routesClient, {
    languageCode: env.GOOGLE_LANGUAGE_CODE,
    regionCode: env.GOOGLE_REGION_CODE,
  });

  const flightProvider: FlightProvider = env.FLIGHTAWARE_AEROAPI_KEY
    ? new AeroApiFlightProvider({
        apiKey: env.FLIGHTAWARE_AEROAPI_KEY,
        baseUrl: env.AEROAPI_BASE_URL,
        maxRequestsPerMinute: env.AEROAPI_MAX_REQUESTS_PER_MINUTE,
        fetchFn,
      })
    : new UnconfiguredFlightProvider();
  const airports = new AirportDirectory({ dataUrl: env.AIRPORTS_DATA_URL, cacheDir: env.AIRPORTS_CACHE_DIR, fetchFn });
  const flights = new FlightService(flightProvider, airports, routes, timeZones, {
    minDistanceKm: env.FLIGHT_MIN_DISTANCE_KM,
    airportSearchRadiusKm: env.FLIGHT_AIRPORT_SEARCH_RADIUS_KM,
    maxAirportsPerSide: env.FLIGHT_MAX_AIRPORTS_PER_SIDE,
    maxOptions: env.FLIGHT_MAX_OPTIONS,
  });

  const locators: SignalLocationSource[] = env.SIGNALS_OSM_ENABLED
    ? [new OsmTrafficSignalLocator(env.OVERPASS_API_URL, fetchFn)]
    : [];
  const bridge = env.SIGNALS_HAMBURG_TLD_ENABLED
    ? new HamburgMqttBridge(env.HAMBURG_TLD_MQTT_URL, env.HTTPS_PROXY)
    : undefined;
  const signalProviders: TrafficSignalProvider[] = env.SIGNALS_HAMBURG_TLD_ENABLED
    ? [
        new HamburgTldProvider({
          baseUrl: env.HAMBURG_TLD_BASE_URL,
          staleAfterSeconds: env.SIGNALS_STALE_AFTER_SECONDS,
          fetchFn,
          bridge,
        }),
      ]
    : [];
  const signals = new TrafficSignalService(
    locators,
    signalProviders,
    { maxRouteKm: env.SIGNALS_MAX_ROUTE_KM },
    env.TRAFFIC_SIGNAL_DEMO_MODE ? new DemoTrafficSignalProvider() : undefined,
  );

  const capabilities: Capabilities = {
    google: { serverKeyConfigured: platform.configured },
    routes: { trafficOnPolyline: env.ROUTES_TRAFFIC_ON_POLYLINE, tolls: env.ROUTES_TOLLS },
    flights: {
      configured: flightProvider.configured,
      provider: flightProvider.configured ? flightProvider.name : null,
      minDistanceKm: env.FLIGHT_MIN_DISTANCE_KM,
      airportSearchRadiusKm: env.FLIGHT_AIRPORT_SEARCH_RADIUS_KM,
    },
    signals: {
      osm: env.SIGNALS_OSM_ENABLED,
      hamburgTld: env.SIGNALS_HAMBURG_TLD_ENABLED,
      demoMode: env.TRAFFIC_SIGNAL_DEMO_MODE,
      maxRouteKm: env.SIGNALS_MAX_ROUTE_KM,
    },
  };

  return {
    places,
    routes,
    transit,
    flights,
    signals,
    capabilities,
    airports,
    shutdown: () => bridge?.close(),
  };
}
