import {
  formatDistance,
  formatDuration,
  formatMoney,
  formatTimePoint,
  formatZoneAbbrev,
  MODE_LABELS,
  type LatLng,
  type ModeResult,
  type RouteOption,
  type Segment,
} from '@nexus/shared';
import { COLORS, normalizeColor, TRAFFIC_LABELS, trafficSummary } from '../../services/MapService';
import { DataBadge, ManeuverGlyph, ModeIcon } from '../common/ui';

interface Props {
  option: RouteOption;
  result: ModeResult;
  onSelectOption: (optionId: string) => void;
  onFocusPoint: (p: LatLng) => void;
}

export function RouteDetails({ option, result, onSelectOption, onFocusPoint }: Props) {
  const traffic = trafficSummary(option);
  return (
    <section className="details" aria-labelledby="details-title">
      <header className="details__header">
        <p className="eyebrow" id="details-title">
          Detalhes do trajeto
        </p>
        <h2 className="details__title">
          <ModeIcon mode={option.mode} size={22} /> {MODE_LABELS[option.mode]}
          {option.summary && <span className="details__summary"> · {option.summary}</span>}
        </h2>
        <dl className="facts">
          <div>
            <dt>Saída</dt>
            <dd>{formatTimePoint(option.departure)}</dd>
          </div>
          <div>
            <dt>Chegada estimada</dt>
            <dd>{formatTimePoint(option.arrival, option.departure)}</dd>
          </div>
          <div>
            <dt>{option.mode === 'drive' ? 'Tempo com trânsito' : 'Duração total'}</dt>
            <dd>{formatDuration(option.durationSeconds)}</dd>
          </div>
          {option.mode === 'drive' && option.staticDurationSeconds !== undefined && (
            <div>
              <dt>Tempo sem trânsito</dt>
              <dd>{formatDuration(option.staticDurationSeconds)}</dd>
            </div>
          )}
          {option.distanceMeters !== undefined && option.mode !== 'flight' && (
            <div>
              <dt>Distância</dt>
              <dd>{formatDistance(option.distanceMeters)}</dd>
            </div>
          )}
          {option.transfers !== undefined && (
            <div>
              <dt>Baldeações</dt>
              <dd>{option.transfers}</dd>
            </div>
          )}
        </dl>
        <p className="details__freshness">
          <DataBadge freshness={option.traffic.freshness} /> <span>{option.traffic.note}</span>
        </p>
      </header>

      {result.options.length > 1 && (
        <div className="alternatives" role="group" aria-label="Rotas alternativas">
          {result.options.map((o, i) => (
            <button
              key={o.id}
              type="button"
              className={`alt-chip ${o.id === option.id ? 'is-active' : ''}`}
              aria-pressed={o.id === option.id}
              onClick={() => onSelectOption(o.id)}
            >
              <span className="alt-chip__n">{i + 1}</span>
              <span className="alt-chip__dur">{formatDuration(o.durationSeconds)}</span>
              {o.summary && <span className="alt-chip__via">{o.summary}</span>}
            </button>
          ))}
        </div>
      )}

      {option.mode === 'drive' && (
        <div className="drive-extra">
          {option.traffic.delaySeconds !== undefined && option.traffic.delaySeconds >= 60 && (
            <p>Atraso estimado por trânsito: {formatDuration(option.traffic.delaySeconds)}</p>
          )}
          {traffic.length > 0 && (
            <ul className="traffic-legend" aria-label="Trânsito na rota (Routes API)">
              {traffic.map((t) => (
                <li key={t.speed}>
                  <span className="swatch" style={{ background: COLORS.traffic[t.speed] }} aria-hidden="true" />
                  {TRAFFIC_LABELS[t.speed]}: {formatDistance(t.meters)}
                </li>
              ))}
            </ul>
          )}
          {option.tolls && (
            <p>
              Pedágio:{' '}
              {!option.tolls.present
                ? 'nenhum previsto pela Routes API'
                : option.tolls.estimatedPrices.length > 0
                  ? option.tolls.estimatedPrices.map((p) => formatMoney(p.amount, p.currencyCode)).join(' + ') + ' (estimativa da Routes API)'
                  : 'há pedágio no trajeto; valor não informado'}
            </p>
          )}
        </div>
      )}

      {option.warnings.length > 0 && (
        <ul className="warnings" aria-label="Avisos">
          {option.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}

      <ol className="timeline">
        {option.segments.map((seg, i) => (
          <SegmentItem key={i} seg={seg} onFocusPoint={onFocusPoint} />
        ))}
      </ol>

      {option.scheduleNote && <p className="hint">{option.scheduleNote}</p>}
      {result.timing && <p className="hint">Método: {result.timing.method}</p>}
      <p className="hint">Fonte: {result.provider}</p>
    </section>
  );
}

function SegmentItem({ seg, onFocusPoint }: { seg: Segment; onFocusPoint: (p: LatLng) => void }) {
  switch (seg.kind) {
    case 'drive':
    case 'walk':
      return (
        <li className={`seg seg--${seg.kind}`}>
          <p className="seg__title">
            <ModeIcon mode={seg.kind} size={16} />
            {seg.label ?? (seg.kind === 'drive' ? 'De carro' : 'A pé')} · {formatDuration(seg.durationSeconds)} · {formatDistance(seg.distanceMeters)}
            {seg.departure && <span className="seg__time"> · {formatTimePoint(seg.departure)}</span>}
          </p>
          {seg.steps.length > 0 && (
            <ol className="steps">
              {seg.steps.map((s, j) => (
                <li key={j}>
                  <button type="button" className="step" disabled={!s.startLocation} onClick={() => s.startLocation && onFocusPoint(s.startLocation)}>
                    <ManeuverGlyph maneuver={s.maneuver} />
                    <span className="step__text">{s.instruction}</span>
                    {s.distanceMeters !== undefined && s.distanceMeters > 0 && <span className="step__dist">{formatDistance(s.distanceMeters)}</span>}
                  </button>
                </li>
              ))}
            </ol>
          )}
        </li>
      );
    case 'transit': {
      const color = normalizeColor(seg.line.color) ?? COLORS.rail;
      const lineName = seg.line.shortName ?? seg.line.name ?? seg.line.vehicleName ?? 'Linha';
      return (
        <li className="seg seg--transit" style={{ ['--line' as string]: color }}>
          <p className="seg__title">
            <span className="line-pill" style={{ background: color, color: normalizeColor(seg.line.textColor) ?? '#fff' }}>
              {lineName}
            </span>
            {seg.line.vehicleName ?? seg.line.vehicleType}
            {seg.line.agencies.length > 0 && <span className="seg__agency"> · {seg.line.agencies.join(', ')}</span>}
          </p>
          <ul className="transit-stops">
            <li>
              <button type="button" className="link-btn" disabled={!seg.departureStop.location} onClick={() => seg.departureStop.location && onFocusPoint(seg.departureStop.location)}>
                Embarque: <strong>{seg.departureStop.name}</strong>
              </button>{' '}
              às <time dateTime={seg.departure.instant}>{formatTimePoint(seg.departure)}</time>
            </li>
            {seg.headsign && <li>Sentido: {seg.headsign}</li>}
            {seg.stopCount !== undefined && <li>{seg.stopCount} parada(s) até o desembarque</li>}
            <li>
              <button type="button" className="link-btn" disabled={!seg.arrivalStop.location} onClick={() => seg.arrivalStop.location && onFocusPoint(seg.arrivalStop.location)}>
                Desembarque: <strong>{seg.arrivalStop.name}</strong>
              </button>{' '}
              às <time dateTime={seg.arrival.instant}>{formatTimePoint(seg.arrival, seg.departure)}</time>
            </li>
            <li className="muted">
              {formatDuration(seg.durationSeconds)}
              {seg.headwaySeconds ? ` · intervalo entre partidas: ${formatDuration(seg.headwaySeconds)}` : ''}
            </li>
          </ul>
        </li>
      );
    }
    case 'flight':
      return (
        <li className="seg seg--flight">
          <p className="seg__title">
            <ModeIcon mode="flight" size={16} /> Voo {seg.flight.ident}
            {seg.flight.aircraftType && <span className="muted"> · aeronave {seg.flight.aircraftType}</span>}
          </p>
          <div className="flight-board">
            <div>
              <span className="iata">{seg.from.iata}</span>
              <span className="airport-name">{seg.from.name}</span>
              <span>
                Partida <strong>{formatTimePoint(seg.departure)}</strong>
                {seg.departure.timeZone && <span className="muted"> {formatZoneAbbrev(seg.departure.instant, seg.departure.timeZone)}</span>}
              </span>
            </div>
            <span className="flight-board__arrow" aria-hidden="true">
              ✈
            </span>
            <div>
              <span className="iata">{seg.to.iata}</span>
              <span className="airport-name">{seg.to.name}</span>
              <span>
                Chegada <strong>{formatTimePoint(seg.arrival, seg.departure)}</strong>
                {seg.arrival.timeZone && <span className="muted"> {formatZoneAbbrev(seg.arrival.instant, seg.arrival.timeZone)}</span>}
              </span>
            </div>
          </div>
          <p className="muted">
            Duração {formatDuration(seg.durationSeconds)} · horário publicado pela companhia ({seg.flight.provider}). No mapa, a linha tracejada é uma
            representação do trecho aéreo, não a trajetória real da aeronave.
          </p>
        </li>
      );
    case 'buffer':
      return (
        <li className="seg seg--buffer">
          <p className="seg__title">
            ⏱ {seg.label}: {formatDuration(seg.durationSeconds)}
          </p>
        </li>
      );
  }
}
