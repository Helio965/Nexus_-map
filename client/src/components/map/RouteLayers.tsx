import type { RouteOption } from '@nexus/shared';
import { AdvancedMarker, Polyline } from '@vis.gl/react-google-maps';
import { useMemo } from 'react';
import { COLORS, flightLabelPoint, linesForOption, stationsOf, type DrawableLine } from '../../services/MapService';

function iconsFor(line: DrawableLine): google.maps.IconSequence[] | undefined {
  if (line.style === 'dotted') {
    return [
      {
        icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: line.color, fillOpacity: 1, strokeColor: COLORS.outline, strokeWeight: 1, scale: 3 },
        offset: '0',
        repeat: '11px',
      },
    ];
  }
  if (line.style === 'dashed') {
    return [{ icon: { path: 'M 0,-1 0,1', strokeColor: line.color, strokeOpacity: 1, strokeWeight: line.weight, scale: 3 }, offset: '0', repeat: '16px' }];
  }
  return undefined;
}

function Line({ line, onClick, outline }: { line: DrawableLine; onClick?: () => void; outline: boolean }) {
  const icons = iconsFor(line);
  return (
    <>
      {outline && line.style === 'solid' && (
        <Polyline path={line.path} strokeColor={COLORS.outline} strokeOpacity={0.85} strokeWeight={line.weight + 4} zIndex={line.zIndex - 1} geodesic={line.geodesic} clickable={false} />
      )}
      <Polyline
        path={line.path}
        strokeColor={line.color}
        strokeOpacity={icons ? 0 : 1}
        strokeWeight={line.weight}
        zIndex={line.zIndex}
        geodesic={line.geodesic}
        icons={icons}
        clickable={!!onClick}
        onClick={onClick}
      />
    </>
  );
}

export function RouteLayers({
  options,
  selected,
  onSelect,
}: {
  options: RouteOption[];
  selected: RouteOption | null;
  onSelect: (optionId: string) => void;
}) {
  const alternatives = useMemo(
    () => options.filter((o) => o.id !== selected?.id).flatMap((o) => linesForOption(o, false).map((l) => ({ l, id: o.id }))),
    [options, selected],
  );
  const active = useMemo(() => (selected ? linesForOption(selected, true) : []), [selected]);
  const stations = useMemo(() => (selected ? stationsOf(selected) : []), [selected]);
  const flightLabel = useMemo(() => (selected ? flightLabelPoint(selected) : null), [selected]);
  const airports = useMemo(() => {
    const f = selected?.segments.find((s) => s.kind === 'flight');
    return f && f.kind === 'flight' ? [f.from, f.to] : [];
  }, [selected]);

  return (
    <>
      {alternatives.map(({ l, id }) => (
        <Line key={l.key} line={l} outline={false} onClick={() => onSelect(id)} />
      ))}
      {active.map((l) => (
        <Line key={l.key} line={l} outline />
      ))}
      {stations.map((s) => (
        <AdvancedMarker key={s.key} position={s.stop.location} title={`${s.role === 'board' ? 'Embarque' : 'Desembarque'}: ${s.stop.name} (${s.line})`} zIndex={30}>
          <div className="station-marker" style={{ borderColor: s.color }}>
            <span className="station-marker__dot" style={{ background: s.color }} />
            <span className="station-marker__name">{s.stop.name}</span>
          </div>
        </AdvancedMarker>
      ))}
      {airports.map((a) => (
        <AdvancedMarker key={a.iata} position={a.location} title={`${a.name} (${a.iata})`} zIndex={35}>
          <div className="airport-marker">
            ✈ <strong>{a.iata}</strong>
          </div>
        </AdvancedMarker>
      ))}
      {flightLabel && (
        <AdvancedMarker position={flightLabel} zIndex={36} title="Representação do trecho aéreo">
          <div className="flight-label">Representação do trecho aéreo</div>
        </AdvancedMarker>
      )}
    </>
  );
}
