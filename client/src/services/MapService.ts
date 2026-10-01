import {
  boundsOf,
  decodePolyline,
  greatCirclePoints,
  haversineMeters,
  type Bounds,
  type LatLng,
  type RouteOption,
  type Segment,
  type StopInfo,
  type TrafficSpeed,
} from '@nexus/shared';

/**
 * Lógica de apresentação do mapa, separada dos componentes: cores, divisão da polilinha
 * por trânsito, limites e pontos de interesse. Não cria geometria: só recorta/combina a
 * geometria que veio dos provedores. A única linha "sintética" é o arco do trecho aéreo,
 * que é sempre rotulado como representação.
 */

export const COLORS = {
  drive: '#2b8cff',
  walk: '#12b5a6',
  rail: '#e0237f',
  flight: '#ff7a1a',
  alternative: '#8a96a8',
  outline: '#0b1017',
  traffic: {
    NORMAL: '#1fbf75',
    SLOW: '#f5a524',
    TRAFFIC_JAM: '#e5484d',
  } satisfies Record<TrafficSpeed, string>,
} as const;

export const TRAFFIC_LABELS: Record<TrafficSpeed, string> = {
  NORMAL: 'Fluxo normal',
  SLOW: 'Trânsito lento',
  TRAFFIC_JAM: 'Congestionamento',
};

export type LineStyle = 'solid' | 'dotted' | 'dashed';

export interface DrawableLine {
  key: string;
  path: LatLng[];
  color: string;
  style: LineStyle;
  weight: number;
  zIndex: number;
  /** Rótulo acessível/explicativo (ex.: "Congestionamento"). */
  label?: string;
  geodesic?: boolean;
}

/** Divide uma polilinha conforme os intervalos de trânsito (índices de pontos). */
export function splitByTraffic(
  path: LatLng[],
  intervals: Array<{ start: number; end: number; speed: TrafficSpeed }> | undefined,
): Array<{ path: LatLng[]; speed?: TrafficSpeed }> {
  if (!intervals || intervals.length === 0 || path.length < 2) return [{ path }];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out: Array<{ path: LatLng[]; speed?: TrafficSpeed }> = [];
  let cursor = 0;
  for (const iv of sorted) {
    if (iv.start > cursor) out.push({ path: path.slice(cursor, iv.start + 1) });
    out.push({ path: path.slice(iv.start, iv.end + 1), speed: iv.speed });
    cursor = Math.max(cursor, iv.end);
  }
  if (cursor < path.length - 1) out.push({ path: path.slice(cursor) });
  return out.filter((p) => p.path.length >= 2);
}

function segmentLines(seg: Segment, index: number, active: boolean): DrawableLine[] {
  const z = active ? 20 : 5;
  switch (seg.kind) {
    case 'drive': {
      const path = decodePolyline(seg.polyline);
      if (!active)
        return [
          {
            key: `s${index}`,
            path,
            color: COLORS.alternative,
            style: 'solid',
            weight: 5,
            zIndex: z,
          },
        ];
      return splitByTraffic(path, seg.traffic).map((part, j) => ({
        key: `s${index}-${j}`,
        path: part.path,
        color: part.speed ? COLORS.traffic[part.speed] : COLORS.drive,
        style: 'solid' as const,
        weight: 6,
        zIndex: z + (part.speed === 'TRAFFIC_JAM' ? 2 : part.speed === 'SLOW' ? 1 : 0),
        label: part.speed ? TRAFFIC_LABELS[part.speed] : undefined,
      }));
    }
    case 'walk':
      return [
        {
          key: `s${index}`,
          path: decodePolyline(seg.polyline),
          color: active ? COLORS.walk : COLORS.alternative,
          style: 'dotted',
          weight: 5,
          zIndex: z,
          label: 'Trecho a pé',
        },
      ];
    case 'transit': {
      const path = seg.polyline
        ? decodePolyline(seg.polyline)
        : [seg.departureStop.location, seg.arrivalStop.location].filter((p): p is LatLng => !!p);
      return [
        {
          key: `s${index}`,
          path,
          color: active ? (normalizeColor(seg.line.color) ?? COLORS.rail) : COLORS.alternative,
          style: 'solid',
          weight: 7,
          zIndex: z + 1,
          label: seg.line.shortName ?? seg.line.name,
        },
      ];
    }
    case 'flight':
      return [
        {
          key: `s${index}`,
          path: greatCirclePoints(seg.from.location, seg.to.location, 96),
          color: active ? COLORS.flight : COLORS.alternative,
          style: 'dashed',
          weight: 4,
          zIndex: z + 2,
          label: 'Representação do trecho aéreo',
          geodesic: true,
        },
      ];
    case 'buffer':
      return [];
  }
}

export function linesForOption(option: RouteOption, active: boolean): DrawableLine[] {
  return option.segments
    .flatMap((seg, i) => segmentLines(seg, i, active))
    .map((l) => ({
      ...l,
      key: `${option.id}-${l.key}`,
    }));
}

export function normalizeColor(c: string | undefined): string | undefined {
  if (!c) return undefined;
  const v = c.startsWith('#') ? c : `#${c}`;
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : undefined;
}

export interface StationMarker {
  key: string;
  stop: StopInfo & { location: LatLng };
  role: 'board' | 'alight';
  line: string;
  color: string;
}

export function stationsOf(option: RouteOption): StationMarker[] {
  const out: StationMarker[] = [];
  option.segments.forEach((s, i) => {
    if (s.kind !== 'transit') return;
    const color = normalizeColor(s.line.color) ?? COLORS.rail;
    const line = s.line.shortName ?? s.line.name ?? s.line.vehicleName ?? 'Linha';
    if (s.departureStop.location)
      out.push({
        key: `${i}-b`,
        stop: { ...s.departureStop, location: s.departureStop.location },
        role: 'board',
        line,
        color,
      });
    if (s.arrivalStop.location)
      out.push({
        key: `${i}-a`,
        stop: { ...s.arrivalStop, location: s.arrivalStop.location },
        role: 'alight',
        line,
        color,
      });
  });
  return out;
}

/** Ponto médio do arco (para o rótulo "Representação do trecho aéreo"). */
export function flightLabelPoint(option: RouteOption): LatLng | null {
  const f = option.segments.find((s) => s.kind === 'flight');
  if (!f || f.kind !== 'flight') return null;
  const arc = greatCirclePoints(f.from.location, f.to.location, 2);
  return arc[1] ?? null;
}

export function optionBounds(option: RouteOption): Bounds | undefined {
  const pts = linesForOption(option, true).flatMap((l) => l.path);
  return boundsOf(pts) ?? option.bounds;
}

/** Extensão (m) de cada categoria de trânsito informada pela API na rota. */
export function trafficSummary(
  option: RouteOption,
): Array<{ speed: TrafficSpeed; meters: number }> {
  const totals = new Map<TrafficSpeed, number>();
  for (const seg of option.segments) {
    if (seg.kind !== 'drive' || !seg.traffic) continue;
    const path = decodePolyline(seg.polyline);
    for (const part of splitByTraffic(path, seg.traffic)) {
      if (!part.speed) continue;
      let m = 0;
      for (let i = 1; i < part.path.length; i++)
        m += haversineMeters(part.path[i - 1]!, part.path[i]!);
      totals.set(part.speed, (totals.get(part.speed) ?? 0) + m);
    }
  }
  return (['TRAFFIC_JAM', 'SLOW', 'NORMAL'] as TrafficSpeed[])
    .filter((s) => totals.has(s))
    .map((speed) => ({ speed, meters: totals.get(speed)! }));
}

/** Polilinha do trecho de carro usado para buscar semáforos (somente rotas de carro). */
export function drivePolylineForSignals(option: RouteOption | null): string | null {
  if (!option || option.mode !== 'drive') return null;
  const seg = option.segments.find((s) => s.kind === 'drive');
  return seg && seg.kind === 'drive' ? seg.polyline : null;
}
