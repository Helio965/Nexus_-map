import { SIGNAL_PHASE_LABELS, type DemoSignalFeature, type SignalStateUpdate, type TrafficSignalFeature } from '@nexus/shared';
import { AdvancedMarker, InfoWindow, useAdvancedMarkerRef } from '@vis.gl/react-google-maps';
import { useState } from 'react';
import { useNow } from '../../hooks/basic';
import { ApproachLine } from '../signals/SignalsPanel';

function markerSummary(f: TrafficSignalFeature, states: Record<string, SignalStateUpdate>): { cls: string; text: string; emoji: string } {
  if (f.telemetry.status !== 'live') return { cls: 'none', text: 'SEM ESTADO', emoji: '🚦' };
  const phases = f.telemetry.approaches.map((a) => states[a.streamId] ?? a);
  const fresh = phases.filter((p) => p.phase && !p.stale);
  if (fresh.length === 0) return { cls: 'none', text: 'SEM DADO ATUAL', emoji: '🚦' };
  const unique = [...new Set(fresh.map((p) => p.phase!))];
  if (unique.length > 1) return { cls: 'mixed', text: 'FAIXAS DIFERENTES', emoji: '🚦' };
  const l = SIGNAL_PHASE_LABELS[unique[0]!];
  return { cls: unique[0]!, text: l.text, emoji: l.emoji };
}

function SignalMarker({ feature, states, nowMs }: { feature: TrafficSignalFeature; states: Record<string, SignalStateUpdate>; nowMs: number }) {
  const [ref, marker] = useAdvancedMarkerRef();
  const [open, setOpen] = useState(false);
  const s = markerSummary(feature, states);
  return (
    <>
      <AdvancedMarker ref={ref} position={feature.location} zIndex={40} title={`${feature.label}: ${s.text}`} onClick={() => setOpen((v) => !v)}>
        <div className={`sig sig--${s.cls}`}>
          <span aria-hidden="true">{s.emoji}</span>
          {s.cls !== 'none' && <b>{s.text}</b>}
        </div>
      </AdvancedMarker>
      {open && (
        <InfoWindow anchor={marker} onCloseClick={() => setOpen(false)} headerContent={<strong>🚦 {feature.label}</strong>}>
          <div className="info">
            {feature.telemetry.status === 'live' ? (
              <ul className="approaches">
                {feature.telemetry.approaches.map((a) => (
                  <ApproachLine key={a.streamId} approach={a} state={states[a.streamId]} nowMs={nowMs} />
                ))}
              </ul>
            ) : (
              <p>{feature.telemetry.reason}</p>
            )}
            <p className="info__source">Fonte: {feature.sources.map((x) => x.attribution).join(' · ')}</p>
          </div>
        </InfoWindow>
      )}
    </>
  );
}

export function SignalMarkers({
  features,
  states,
  clockOffsetMs,
}: {
  features: TrafficSignalFeature[];
  states: Record<string, SignalStateUpdate>;
  clockOffsetMs: number;
}) {
  const live = features.some((f) => f.telemetry.status === 'live');
  const nowMs = useNow(1000, live) + clockOffsetMs;
  return (
    <>
      {features.map((f) => (
        <SignalMarker key={f.id} feature={f} states={states} nowMs={nowMs} />
      ))}
    </>
  );
}

export function DemoSignalMarkers({ features, clockOffsetMs }: { features: DemoSignalFeature[]; clockOffsetMs: number }) {
  const nowMs = useNow(500) + clockOffsetMs;
  return (
    <>
      {features.map((f) => {
        const l = SIGNAL_PHASE_LABELS[f.phase];
        const s = Math.max(0, Math.round((Date.parse(f.nextChangeAt) - nowMs) / 1000));
        return (
          <AdvancedMarker key={f.id} position={f.location} zIndex={41} title={`${f.label}: ${l.text} (simulado)`}>
            <div className={`sig sig--demo sig--${f.phase}`}>
              <i>DEMO</i>
              <span aria-hidden="true">{l.emoji}</span>
              <b>{l.text}</b>
              <span className="sig__count">{`00:${String(s).padStart(2, '0')}`}</span>
            </div>
          </AdvancedMarker>
        );
      })}
    </>
  );
}
