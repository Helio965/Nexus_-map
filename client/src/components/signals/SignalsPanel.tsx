import {
  DEMO_SIGNAL_BANNER,
  formatDistance,
  SIGNAL_PHASE_LABELS,
  type DemoSignalResponse,
  type SignalApproachState,
  type SignalStateUpdate,
  type TrafficSignalFeature,
} from '@nexus/shared';
import { useNow } from '../../hooks/basic';
import type { SignalLayerStatus, StreamStatus } from '../../hooks/useSignalLayer';
import { DataBadge, Notice, Spinner } from '../common/ui';

function elapsed(fromIso: string | undefined, nowMs: number): string | null {
  if (!fromIso) return null;
  const s = Math.max(0, Math.round((nowMs - Date.parse(fromIso)) / 1000));
  if (s < 60) return `há ${s} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `há ${m} min` : `há ${Math.floor(m / 60)} h`;
}

function countdown(toIso: string, nowMs: number): string {
  const s = Math.max(0, Math.round((Date.parse(toIso) - nowMs) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Linha de estado de UMA aproximação (faixa) — cor sempre acompanhada de texto. */
export function ApproachLine({
  approach,
  state,
  nowMs,
}: {
  approach: SignalApproachState;
  state?: SignalStateUpdate;
  nowMs: number;
}) {
  const s = state ?? approach;
  const lane = `faixa ${approach.laneConnection}${approach.signalGroup ? `, grupo ${approach.signalGroup}` : ''}`;
  if (!s.phase) {
    return (
      <li className="approach approach--none">
        <span>Sem observação publicada pela fonte</span>
        <span className="muted">
          {' '}
          · {approach.travelDirection} · {lane}
        </span>
      </li>
    );
  }
  const label = SIGNAL_PHASE_LABELS[s.phase];
  if (s.stale) {
    return (
      <li className="approach approach--stale">
        <span>
          ⚠ Última fase informada: {label.text} {elapsed(s.phaseSince, nowMs)} — pode estar
          desatualizada
        </span>
        <span className="muted">
          {' '}
          · {approach.travelDirection} · {lane}
        </span>
      </li>
    );
  }
  return (
    <li className={`approach approach--${s.phase}`}>
      <span className="phase">
        <span aria-hidden="true">{label.emoji}</span> {label.text}
      </span>
      {s.nextChangeAt ? (
        <span className="countdown" aria-label="Tempo restante informado pela fonte">
          {countdown(s.nextChangeAt, nowMs)}
        </span>
      ) : (
        <span className="muted">
          {' '}
          · desde {elapsed(s.phaseSince, nowMs)} (a fonte não informa tempo restante)
        </span>
      )}
      <span className="muted">
        {' '}
        · {approach.travelDirection} · {lane}
      </span>
    </li>
  );
}

interface Props {
  layer: SignalLayerStatus;
  states: Record<string, SignalStateUpdate>;
  stream: StreamStatus;
  clockOffsetMs: number;
  onFocus: (f: TrafficSignalFeature) => void;
}

export function SignalsPanel({ layer, states, stream, clockOffsetMs, onFocus }: Props) {
  const hasLive =
    layer.status === 'ready' && layer.data.features.some((f) => f.telemetry.status === 'live');
  const nowMs = useNow(1000, hasLive) + clockOffsetMs;

  if (layer.status === 'off') return null;
  return (
    <section className="signals" aria-labelledby="signals-title">
      <p className="eyebrow" id="signals-title">
        Semáforos na rota
      </p>
      {layer.status === 'no_route' && (
        <p className="hint">Selecione uma rota de carro para ver os semáforos do trajeto.</p>
      )}
      {layer.status === 'loading' && (
        <p className="hint" role="status">
          <Spinner /> Buscando semáforos e telemetria…
        </p>
      )}
      {layer.status === 'error' && <Notice tone="error">{layer.message}</Notice>}
      {layer.status === 'ready' && (
        <>
          {layer.data.messages.map((m) => (
            <Notice key={m} tone={layer.data.status === 'route_too_long' ? 'info' : 'warn'}>
              {m}
            </Notice>
          ))}
          {hasLive && (
            <p className="stream-status" role="status">
              {stream === 'open' ? (
                <>
                  <DataBadge freshness="live" /> Conectado à telemetria
                </>
              ) : stream === 'reconnecting' ? (
                'Reconectando à telemetria…'
              ) : (
                'Conectando à telemetria…'
              )}
            </p>
          )}
          {layer.data.features.length === 0 && layer.data.status === 'ok' && (
            <p className="hint">
              Nenhum semáforo identificado ao longo desta rota pelas fontes disponíveis.
            </p>
          )}
          <ul className="signal-list">
            {layer.data.features.map((f) => (
              <li key={f.id} className={`signal-item signal-item--${f.telemetry.status}`}>
                <button
                  type="button"
                  className="link-btn signal-item__name"
                  onClick={() => onFocus(f)}
                >
                  🚦 {f.label}
                </button>
                {f.distanceAlongRouteMeters !== undefined && (
                  <span className="muted">
                    {' '}
                    · a {formatDistance(f.distanceAlongRouteMeters)} do início
                  </span>
                )}
                {f.telemetry.status === 'live' ? (
                  <ul className="approaches">
                    {f.telemetry.approaches.map((a) => (
                      <ApproachLine
                        key={a.streamId}
                        approach={a}
                        state={states[a.streamId]}
                        nowMs={nowMs}
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="signal-item__none">
                    <DataBadge freshness="static" /> {f.telemetry.reason}
                  </p>
                )}
                <p className="signal-item__source">
                  Fonte: {f.sources.map((s) => s.attribution).join(' · ')}
                </p>
              </li>
            ))}
          </ul>
          <p className="hint">
            Fontes consultadas:{' '}
            {layer.data.providers
              .map(
                (p) =>
                  `${p.name} (${p.status === 'ok' ? 'ok' : p.status === 'not_applicable' ? 'fora da área atendida' : p.status === 'error' ? 'indisponível' : 'desativada'})`,
              )
              .join(' · ') || '—'}
          </p>
        </>
      )}
    </section>
  );
}

export function DemoSignalsPanel({
  data,
  error,
  clockOffsetMs,
}: {
  data: DemoSignalResponse | null;
  error: string | null;
  clockOffsetMs: number;
}) {
  const nowMs = useNow(500, !!data) + clockOffsetMs;
  return (
    <section className="signals signals--demo" aria-labelledby="demo-title">
      <Notice tone="demo" title={DEMO_SIGNAL_BANNER} role="status">
        Estes estados e contagens são SIMULADOS para testar a interface. Os pontos ficam em
        distâncias fixas da rota e não correspondem a semáforos reais.
      </Notice>
      <p className="eyebrow" id="demo-title">
        Semáforos simulados
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      {!data && !error && <Spinner label="Carregando simulação" />}
      <ul className="signal-list">
        {data?.features.map((f) => {
          const label = SIGNAL_PHASE_LABELS[f.phase];
          return (
            <li key={f.id} className={`signal-item approach--${f.phase}`}>
              <strong>{f.label}</strong>
              <span className="phase">
                {' '}
                <span aria-hidden="true">{label.emoji}</span> {label.text} (simulado)
              </span>
              <span className="countdown"> {countdown(f.nextChangeAt, nowMs)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
