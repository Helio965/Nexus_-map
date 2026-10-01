import type {
  Bounds,
  DemoSignalFeature,
  LatLng,
  PlaceSummary,
  RouteOption,
  SignalStateUpdate,
  TrafficSignalFeature,
} from '@nexus/shared';
import {
  APILoadingStatus,
  APIProvider,
  Map,
  useApiLoadingStatus,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { lazy, Suspense, useEffect, useLayoutEffect, useRef } from 'react';
import { config } from '../../config';
import { optionBounds } from '../../services/MapService';
import { Notice, Spinner } from '../common/ui';
import { LayerSwitcher, type MapLayerType } from './LayerSwitcher';
import { PlaceMarkers } from './PlaceMarkers';
import { RouteLayers } from './RouteLayers';
import { DemoSignalMarkers, SignalMarkers } from './SignalMarkers';

const Map3DView = lazy(() => import('./Map3DView'));

export interface MapPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface MapViewProps {
  layerType: MapLayerType;
  onLayerType: (t: MapLayerType) => void;
  trafficOn: boolean;
  onTraffic: (v: boolean) => void;
  signalsOn: boolean;
  onSignals: (v: boolean) => void;
  demoAvailable: boolean;
  demoOn: boolean;
  onDemo: (v: boolean) => void;
  origin: PlaceSummary | null;
  destination: PlaceSummary | null;
  options: RouteOption[];
  selected: RouteOption | null;
  onSelectOption: (optionId: string) => void;
  signalFeatures: TrafficSignalFeature[];
  signalStates: Record<string, SignalStateUpdate>;
  signalClockOffsetMs: number;
  demoFeatures: DemoSignalFeature[];
  demoClockOffsetMs: number;
  focusPoint: LatLng | null;
  padding: MapPadding;
}

/** Visão inicial: Brasil inteiro (sem pedir localização ao usuário). */
const DEFAULT_CENTER = { lat: -14.235, lng: -51.925 };

export function MapView(props: MapViewProps) {
  if (!config.mapsBrowserKey) {
    return (
      <div className="map map--unavailable" role="img" aria-label="Mapa indisponível">
        <div className="map-unavailable">
          <p className="eyebrow">Mapa indisponível</p>
          <p>
            Configure <code>VITE_GOOGLE_MAPS_BROWSER_KEY</code> (chave da Maps JavaScript API
            restrita ao seu domínio) para exibir o mapa. Nenhuma imagem substituta é desenhada no
            lugar do mapa real.
          </p>
        </div>
      </div>
    );
  }
  return (
    <APIProvider apiKey={config.mapsBrowserKey} language="pt-BR" region="BR" libraries={['marker']}>
      <MapInner {...props} />
    </APIProvider>
  );
}

function MapInner(p: MapViewProps) {
  const status = useApiLoadingStatus();
  const is3d = p.layerType === '3d';

  return (
    <div className="map" aria-label="Mapa" role="region">
      {status === APILoadingStatus.AUTH_FAILURE && (
        <div className="map-overlay-notice">
          <Notice tone="error" title="Chave do mapa recusada">
            A Maps JavaScript API recusou a chave do navegador. Verifique se a API está habilitada e
            se o domínio atual está nas restrições de referrer da chave.
          </Notice>
        </div>
      )}
      {status === APILoadingStatus.FAILED && (
        <div className="map-overlay-notice">
          <Notice tone="error">
            Não foi possível carregar a Maps JavaScript API. Verifique sua conexão.
          </Notice>
        </div>
      )}
      {is3d ? (
        <Suspense
          fallback={
            <div className="map-loading">
              <Spinner label="Carregando mapa 3D" />
            </div>
          }
        >
          <Map3DView origin={p.origin} destination={p.destination} selected={p.selected} />
        </Suspense>
      ) : (
        <Map
          className="map__canvas"
          mapId={config.mapId}
          mapTypeId={p.layerType}
          defaultCenter={DEFAULT_CENTER}
          defaultZoom={4}
          gestureHandling="greedy"
          disableDefaultUI
          zoomControl
          scaleControl
          clickableIcons={false}
          reuseMaps
        >
          <TrafficLayer enabled={p.trafficOn} />
          <ViewportController
            origin={p.origin}
            destination={p.destination}
            selected={p.selected}
            focusPoint={p.focusPoint}
            padding={p.padding}
          />
          <RouteLayers options={p.options} selected={p.selected} onSelect={p.onSelectOption} />
          <PlaceMarkers origin={p.origin} destination={p.destination} />
          {p.signalsOn && !p.demoOn && (
            <SignalMarkers
              features={p.signalFeatures}
              states={p.signalStates}
              clockOffsetMs={p.signalClockOffsetMs}
            />
          )}
          {p.demoOn && (
            <DemoSignalMarkers features={p.demoFeatures} clockOffsetMs={p.demoClockOffsetMs} />
          )}
        </Map>
      )}
      {p.demoOn && (
        <div className="demo-banner" role="status">
          MODO DEMONSTRAÇÃO — dados simulados
        </div>
      )}
      <LayerSwitcher
        value={p.layerType}
        onChange={p.onLayerType}
        trafficOn={p.trafficOn}
        onTraffic={p.onTraffic}
        signalsOn={p.signalsOn}
        onSignals={p.onSignals}
        demoAvailable={p.demoAvailable}
        demoOn={p.demoOn}
        onDemo={p.onDemo}
      />
      {config.mapIdIsDemo && (
        <p className="map-footnote">
          Usando DEMO_MAP_ID (somente testes). Defina VITE_GOOGLE_MAPS_MAP_ID com um Map ID
          vetorial.
        </p>
      )}
    </div>
  );
}

/** Camada de trânsito em tempo real do próprio Google (onde houver cobertura). */
function TrafficLayer({ enabled }: { enabled: boolean }) {
  const map = useMap();
  const mapsLib = useMapsLibrary('maps');
  const layerRef = useRef<google.maps.TrafficLayer | null>(null);
  useEffect(() => {
    if (!map || !mapsLib) return;
    layerRef.current ??= new mapsLib.TrafficLayer({ autoRefresh: true });
    layerRef.current.setMap(enabled ? map : null);
  }, [map, mapsLib, enabled]);
  useEffect(() => () => layerRef.current?.setMap(null), []);
  return null;
}

function toLiteral(b: Bounds): google.maps.LatLngBoundsLiteral {
  return { north: b.north, south: b.south, east: b.east, west: b.west };
}

/** Enquadra a rota/locais sem reconstruir o mapa (respeita o painel sobre o mapa). */
function ViewportController({
  origin,
  destination,
  selected,
  focusPoint,
  padding,
}: {
  origin: PlaceSummary | null;
  destination: PlaceSummary | null;
  selected: RouteOption | null;
  focusPoint: LatLng | null;
  padding: MapPadding;
}) {
  const map = useMap();
  const paddingRef = useRef(padding);
  useLayoutEffect(() => {
    paddingRef.current = padding;
  }, [padding]);

  useEffect(() => {
    if (!map) return;
    if (selected) {
      const b = optionBounds(selected);
      if (b) map.fitBounds(toLiteral(b), paddingRef.current);
      return;
    }
    const pts = [origin?.location, destination?.location].filter((x): x is LatLng => !!x);
    if (pts.length === 2) {
      map.fitBounds(
        {
          north: Math.max(pts[0]!.lat, pts[1]!.lat),
          south: Math.min(pts[0]!.lat, pts[1]!.lat),
          east: Math.max(pts[0]!.lng, pts[1]!.lng),
          west: Math.min(pts[0]!.lng, pts[1]!.lng),
        },
        paddingRef.current,
      );
    } else if (pts.length === 1) {
      map.panTo(pts[0]!);
      map.setZoom(14);
    }
  }, [map, selected, origin, destination]);

  useEffect(() => {
    if (!map || !focusPoint) return;
    map.panTo(focusPoint);
    if ((map.getZoom() ?? 0) < 16) map.setZoom(17);
  }, [map, focusPoint]);

  return null;
}
