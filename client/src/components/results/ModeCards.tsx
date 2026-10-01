import {
  formatDistance,
  formatDuration,
  formatTimePoint,
  MODE_LABELS,
  type ComparisonEntry,
  type ComparisonResult,
  type RouteOption,
  type TravelMode,
} from '@nexus/shared';
import { DataBadge, ModeIcon, Spinner } from '../common/ui';

const PROGRESS_TEXT: Record<TravelMode, string> = {
  drive: 'Calculando a rota de carro e consultando condições de trânsito…',
  walk: 'Calculando a rota a pé…',
  rail: 'Procurando opções de metrô e trens…',
  flight: 'Consultando aeroportos e voos disponíveis…',
};

export function ProgressList({ pending }: { pending: TravelMode[] }) {
  if (pending.length === 0) return null;
  return (
    <div className="progress" role="status" aria-live="polite">
      <p className="progress__title">
        <Spinner /> Calculando a melhor rota…
      </p>
      <ul>
        {pending.map((m) => (
          <li key={m}>
            <ModeIcon mode={m} size={16} /> {PROGRESS_TEXT[m]}
          </li>
        ))}
      </ul>
    </div>
  );
}

function cardDetail(mode: TravelMode, o: RouteOption): string {
  if (mode === 'rail') {
    const t = o.transfers ?? 0;
    return t === 0 ? 'sem baldeação' : `${t} baldeaç${t === 1 ? 'ão' : 'ões'}`;
  }
  if (mode === 'flight') {
    const f = o.segments.find((s) => s.kind === 'flight');
    return f && f.kind === 'flight'
      ? `${f.from.iata} → ${f.to.iata} · voo ${f.flight.ident}`
      : 'voo direto';
  }
  return o.distanceMeters !== undefined ? formatDistance(o.distanceMeters) : '';
}

function DeadlineLine({
  entry,
  deadline,
}: {
  entry: ComparisonEntry;
  deadline?: ComparisonResult['deadline'];
}) {
  if (!deadline || entry.meetsDeadline === undefined) return null;
  if (entry.meetsDeadline) {
    const slack = Math.max(0, entry.slackSeconds ?? 0);
    return (
      <span className="deadline deadline--ok">
        ✓ Atende ao horário{slack >= 60 ? ` (folga de ${formatDuration(slack)})` : ''}
      </span>
    );
  }
  return (
    <span className="deadline deadline--fail">
      ✗ NÃO atende ao horário
      {entry.departureInPast ? ' — a saída necessária já passou' : ''}
    </span>
  );
}

interface CardsProps {
  comparison: ComparisonResult;
  selectedMode: TravelMode | null;
  recommendedMode: TravelMode | null;
  onSelect: (mode: TravelMode, optionId: string) => void;
}

export function ModeCards({ comparison, selectedMode, recommendedMode, onSelect }: CardsProps) {
  const entries = comparison.entries.filter((e) => e.status !== 'not_requested');
  return (
    <ul className="mode-cards" aria-label="Comparação dos meios de transporte">
      {entries.map((e, i) => {
        const o = e.best;
        const selectable = e.status === 'available' && !!o;
        const content = (
          <>
            <span className="mode-card__head">
              <ModeIcon mode={e.mode} size={22} />
              <span className="mode-card__name">{MODE_LABELS[e.mode]}</span>
              {recommendedMode === e.mode && <span className="tag tag--rec">Recomendado</span>}
            </span>
            {e.status === 'pending' && (
              <span className="mode-card__pending">
                <Spinner label={`Calculando ${MODE_LABELS[e.mode]}`} />
                <span className="skeleton__line" />
              </span>
            )}
            {selectable && o && (
              <>
                <span className="mode-card__duration">{formatDuration(o.durationSeconds)}</span>
                <span className="mode-card__meta">{cardDetail(e.mode, o)}</span>
                <span className="mode-card__times">
                  <span>Saída {formatTimePoint(o.departure)}</span>
                  <span>Chegada {formatTimePoint(o.arrival, o.departure)}</span>
                </span>
                <DeadlineLine entry={e} deadline={comparison.deadline} />
                <DataBadge freshness={o.traffic.freshness} title={o.traffic.note} />
              </>
            )}
            {(e.status === 'unavailable' ||
              e.status === 'error' ||
              e.status === 'not_configured') && (
              <span className={`mode-card__message mode-card__message--${e.status}`}>
                {e.status === 'not_configured' && <strong>Configuração necessária. </strong>}
                {e.status === 'error' && <strong>Falha na consulta. </strong>}
                {e.message ??
                  (e.mode === 'flight'
                    ? 'Indisponível para este trajeto.'
                    : 'Sem opção para este trajeto.')}
              </span>
            )}
          </>
        );
        return (
          <li key={e.mode} className="mode-cards__item" style={{ animationDelay: `${i * 60}ms` }}>
            {selectable ? (
              <button
                type="button"
                className={`mode-card mode-card--${e.mode} ${selectedMode === e.mode ? 'is-selected' : ''} ${e.meetsDeadline === false ? 'is-late' : ''}`}
                aria-pressed={selectedMode === e.mode}
                onClick={() => onSelect(e.mode, o!.id)}
              >
                {content}
              </button>
            ) : (
              <div
                className={`mode-card mode-card--${e.mode} mode-card--${e.status}`}
                aria-busy={e.status === 'pending'}
              >
                {content}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function RecommendationCard({
  title,
  reasons,
  fallback,
  timeLabel,
}: {
  title: string | null;
  reasons: string[];
  fallback?: string;
  timeLabel: string;
}) {
  return (
    <section className="recommendation" aria-labelledby="rec-title">
      <p className="eyebrow" id="rec-title">
        Recomendação {timeLabel}
      </p>
      {title ? (
        <>
          <p className="recommendation__mode">{title}</p>
          <p className="recommendation__why">Motivo:</p>
          <ul className="recommendation__reasons">
            {reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <p className="recommendation__criteria">
            Critérios, em ordem: chegar no prazo → duração total → horário de saída → baldeações →
            trânsito. Calculado a partir dos dados retornados, sem opinião automatizada.
          </p>
        </>
      ) : (
        <p className="recommendation__none">{fallback}</p>
      )}
    </section>
  );
}
