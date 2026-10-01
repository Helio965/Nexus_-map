import { FRESHNESS_LABELS, type DataFreshness, type TravelMode } from '@nexus/shared';
import type { ReactNode } from 'react';

/** Estado do dado: símbolo + texto (nunca só cor). */
export function DataBadge({ freshness, title }: { freshness: DataFreshness; title?: string }) {
  const l = FRESHNESS_LABELS[freshness];
  return (
    <span className={`badge badge--${freshness}`} title={title}>
      <span aria-hidden="true" className="badge__symbol">
        {l.symbol}
      </span>
      {l.text}
    </span>
  );
}

export function Notice({
  tone = 'info',
  title,
  children,
  role,
}: {
  tone?: 'info' | 'warn' | 'error' | 'demo';
  title?: string;
  children: ReactNode;
  role?: 'alert' | 'status';
}) {
  return (
    <div className={`notice notice--${tone}`} role={role}>
      {title && <strong className="notice__title">{title}</strong>}
      <div className="notice__body">{children}</div>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="spinner" role={label ? 'status' : undefined} aria-label={label}>
      <span aria-hidden="true" />
    </span>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="skeleton__line" style={{ width: `${92 - i * 17}%` }} />
      ))}
    </div>
  );
}

const MODE_PATHS: Record<TravelMode | 'compare', ReactNode> = {
  compare: (
    <>
      <path d="M4 7h11M4 7l3-3M4 7l3 3" />
      <path d="M20 17H9m11 0-3-3m3 3-3 3" />
    </>
  ),
  drive: (
    <>
      <path d="M5 16V11l2-5h10l2 5v5" />
      <path d="M4 16h16v3H4z" />
      <circle cx="7.5" cy="13" r="0.6" />
      <circle cx="16.5" cy="13" r="0.6" />
    </>
  ),
  walk: (
    <>
      <circle cx="13" cy="4.5" r="1.8" />
      <path d="M11 21l2-6-3-3 1-4 3 3h3" />
      <path d="M10 8 7 11v3" />
    </>
  ),
  rail: (
    <>
      <rect x="6" y="3" width="12" height="13" rx="3" />
      <path d="M6 10h12M9 20l-2 2M15 20l2 2M9 16l-1.5 4M15 16l1.5 4" />
      <circle cx="9.5" cy="13" r="0.6" />
      <circle cx="14.5" cy="13" r="0.6" />
    </>
  ),
  flight: (
    <path d="M21 15.5v-2l-8-4.5V4a1.5 1.5 0 0 0-3 0v5L2 13.5v2l8-2.5v4.5l-2.5 2V21l4-1 4 1v-1.5l-2.5-2V13z" />
  ),
};

export function ModeIcon({ mode, size = 20 }: { mode: TravelMode | 'compare'; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="mode-icon"
    >
      {MODE_PATHS[mode]}
    </svg>
  );
}

export function Icon({
  name,
  size = 18,
}: {
  name: 'swap' | 'locate' | 'layers' | 'traffic' | 'signal' | 'close' | 'chevron' | 'info';
  size?: number;
}) {
  const paths: Record<typeof name, ReactNode> = {
    swap: <path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" />,
    locate: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
      </>
    ),
    layers: <path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5" />,
    traffic: <path d="M4 18c3-8 5-12 8-12s5 4 8 12M12 9v2M12 14v2" />,
    signal: (
      <>
        <rect x="8" y="2" width="8" height="17" rx="3" />
        <circle cx="12" cy="6.5" r="1.4" />
        <circle cx="12" cy="10.5" r="1.4" />
        <circle cx="12" cy="14.5" r="1.4" />
        <path d="M12 19v3" />
      </>
    ),
    close: <path d="M6 6l12 12M18 6 6 18" />,
    chevron: <path d="m6 9 6 6 6-6" />,
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6M12 7.5v.5" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

/** Seta da manobra (texto da instrução sempre presente; a seta é decorativa). */
export function ManeuverGlyph({ maneuver }: { maneuver?: string }) {
  const m = maneuver ?? '';
  let rot = 0;
  let glyph = '↑';
  if (m.includes('UTURN')) glyph = '↶';
  else if (m.includes('ROUNDABOUT')) glyph = '⟳';
  else if (m === 'DEPART') glyph = '●';
  else if (m.includes('FERRY')) glyph = '⛴';
  else if (m.includes('LEFT'))
    rot =
      m.includes('SLIGHT') || m.includes('RAMP') || m.includes('FORK')
        ? -45
        : m.includes('SHARP')
          ? -135
          : -90;
  else if (m.includes('RIGHT'))
    rot =
      m.includes('SLIGHT') || m.includes('RAMP') || m.includes('FORK')
        ? 45
        : m.includes('SHARP')
          ? 135
          : 90;
  return (
    <span className="maneuver" aria-hidden="true" style={{ transform: `rotate(${rot}deg)` }}>
      {glyph}
    </span>
  );
}
