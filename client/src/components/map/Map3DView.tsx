import { haversineMeters, type PlaceSummary, type RouteOption } from '@nexus/shared';
import { Map3D, MapMode, Marker3D, Polyline3D } from '@vis.gl/react-google-maps/3d';
import { useMemo, useState } from 'react';
import { config } from '../../config';
import { COLORS, linesForOption, optionBounds } from '../../services/MapService';
import { Notice } from '../common/ui';

/**
 * Mapa 3D fotorrealista (Maps JavaScript API — 3D Maps, GA). Carregado sob demanda.
 * A cobertura 3D depende da cidade; fora dela o próprio Google exibe imagem de satélite.
 */
export default function Map3DView({
  origin,
  destination,
  selected,
}: {
  origin: PlaceSummary | null;
  destination: PlaceSummary | null;
  selected: RouteOption | null;
}) {
  const [error, setError] = useState(false);
  const lines = useMemo(() => (selected ? linesForOption(selected, true) : []), [selected]);

  const camera = useMemo(() => {
    const b = selected ? optionBounds(selected) : undefined;
    const pts = b
      ? [
          { lat: b.south, lng: b.west },
          { lat: b.north, lng: b.east },
        ]
      : [origin?.location, destination?.location].filter((x): x is { lat: number; lng: number } => !!x);
    if (pts.length === 0) return { center: { lat: -15.7942, lng: -47.8822, altitude: 0 }, range: 4_000_000 };
    const a = pts[0]!;
    const c = pts[pts.length - 1]!;
    const center = { lat: (a.lat + c.lat) / 2, lng: (a.lng + c.lng) / 2, altitude: 0 };
    const span = Math.max(600, haversineMeters(a, c));
    return { center, range: span * 1.6 };
  }, [selected, origin, destination]);

  return (
    <div className="map3d">
      {error && (
        <div className="map-overlay-notice">
          <Notice tone="error">Não foi possível exibir o mapa 3D nesta região/dispositivo.</Notice>
        </div>
      )}
      <Map3D
        key={selected?.id ?? 'none'}
        className="map__canvas"
        mode={MapMode.HYBRID}
        mapId={config.mapIdIsDemo ? undefined : config.mapId}
        defaultCenter={camera.center}
        defaultRange={camera.range}
        defaultTilt={selected ? 55 : 0}
        defaultHeading={0}
        defaultUIHidden={false}
        onError={() => setError(true)}
      >
        {lines.map((l) => (
          <Polyline3D
            key={l.key}
            path={l.path}
            strokeColor={l.color}
            strokeWidth={l.weight + 2}
            outerColor={COLORS.outline}
            outerWidth={0.3}
            drawsOccludedSegments
          />
        ))}
        {origin && <Marker3D position={origin.location} label="A — Origem" />}
        {destination && <Marker3D position={destination.location} label="B — Destino" />}
      </Map3D>
      {selected?.mode === 'flight' && <p className="map-footnote">No 3D, o trecho aéreo também é apenas uma representação, não a trajetória real.</p>}
    </div>
  );
}
