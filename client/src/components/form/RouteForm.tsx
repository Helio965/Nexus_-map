import {
  MODE_LABELS,
  type Capabilities,
  type PlaceSummary,
  type TimeMode,
  type TravelMode,
} from '@nexus/shared';
import { useState } from 'react';
import { api } from '../../api/client';
import type { ModeChoice, PlannerState } from '../../state/plannerReducer';
import { deviceTimeZone } from '../../state/usePlanner';
import { Icon, ModeIcon, Spinner } from '../common/ui';
import { PlaceSearchInput } from './PlaceSearchInput';

interface Props {
  state: PlannerState;
  capabilities: Capabilities | null;
  busy: boolean;
  actions: {
    calculate: () => void;
    setOriginText: (t: string) => void;
    setOriginPlace: (p: PlaceSummary | null, text?: string) => void;
    setDestinationText: (t: string) => void;
    setDestinationPlace: (p: PlaceSummary | null, text?: string) => void;
    swap: () => void;
    setTime: (t: PlannerState['time']) => void;
    setModeChoice: (c: ModeChoice) => void;
    setMargins: (m: { pre?: number; post?: number }) => void;
    setFormError: (m: string | null) => void;
  };
}

const TIME_OPTIONS: Array<{ value: TimeMode; label: string }> = [
  { value: 'now', label: 'Sair agora' },
  { value: 'depart_at', label: 'Sair às' },
  { value: 'arrive_by', label: 'Chegar até' },
];

const MODE_CHOICES: Array<{ value: ModeChoice; label: string }> = [
  { value: 'compare', label: 'Comparar' },
  { value: 'drive', label: MODE_LABELS.drive },
  { value: 'walk', label: MODE_LABELS.walk },
  { value: 'rail', label: 'Metrô' },
  { value: 'flight', label: MODE_LABELS.flight },
];

export function RouteForm({ state, capabilities, busy, actions }: Props) {
  const [locating, setLocating] = useState(false);
  const bias = state.origin.place?.location ?? null;
  const zonePlace =
    state.time.mode === 'depart_at'
      ? state.origin.place
      : state.time.mode === 'arrive_by'
        ? state.destination.place
        : null;
  const zone =
    zonePlace?.timeZone ??
    (zonePlace?.source === 'device_geolocation' ? deviceTimeZone() : undefined);
  const showMargins = state.modeChoice === 'compare' || state.modeChoice === 'flight';

  function locateMe() {
    if (!('geolocation' in navigator)) {
      actions.setFormError('Seu navegador não oferece geolocalização.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const accuracy = Math.round(pos.coords.accuracy);
        try {
          const place = await api.reverse(location);
          actions.setOriginPlace({ ...place, name: `Minha localização (±${accuracy} m)` });
        } catch {
          // Sem geocodificação reversa ainda é um ponto geográfico real (do dispositivo).
          actions.setOriginPlace({
            name: `Minha localização (±${accuracy} m)`,
            location,
            types: [],
            source: 'device_geolocation',
            timeZone: deviceTimeZone(),
            timeZoneSource: 'device',
          });
        } finally {
          setLocating(false);
        }
      },
      (err) => {
        setLocating(false);
        actions.setFormError(
          err.code === err.PERMISSION_DENIED
            ? 'Permissão de localização negada no navegador.'
            : 'Não foi possível obter sua localização agora.',
        );
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }

  const modeDisabled = (m: ModeChoice): string | null => {
    if (!capabilities) return null;
    if (m === 'flight' && !capabilities.flights.configured)
      return 'Fonte de voos não configurada no servidor';
    return null;
  };

  return (
    <form
      className="route-form"
      aria-label="Planejar rota"
      onSubmit={(e) => {
        e.preventDefault();
        actions.calculate();
      }}
    >
      <div className="route-form__places">
        <div className="route-form__rail" aria-hidden="true" />
        <PlaceSearchInput
          label="Origem"
          badge="A"
          text={state.origin.text}
          place={state.origin.place}
          bias={state.destination.place?.location ?? null}
          onText={actions.setOriginText}
          onPlace={(p, t) => actions.setOriginPlace(p, t)}
        />
        <PlaceSearchInput
          label="Destino"
          badge="B"
          text={state.destination.text}
          place={state.destination.place}
          bias={bias}
          onText={actions.setDestinationText}
          onPlace={(p, t) => actions.setDestinationPlace(p, t)}
        />
        <button
          type="button"
          className="icon-btn route-form__swap"
          onClick={actions.swap}
          aria-label="Inverter origem e destino"
          title="Inverter origem e destino"
        >
          <Icon name="swap" />
        </button>
      </div>

      <button
        type="button"
        className="text-btn"
        onClick={locateMe}
        disabled={locating}
        aria-busy={locating}
      >
        {locating ? <Spinner /> : <Icon name="locate" size={16} />}
        Utilizar minha localização como origem
      </button>

      <fieldset className="field-group">
        <legend>Horário</legend>
        <div className="segmented" role="radiogroup" aria-label="Opção de horário">
          {TIME_OPTIONS.map((o) => (
            <label
              key={o.value}
              className={`segmented__item ${state.time.mode === o.value ? 'is-active' : ''}`}
            >
              <input
                type="radio"
                name="time-mode"
                value={o.value}
                checked={state.time.mode === o.value}
                onChange={() => actions.setTime({ ...state.time, mode: o.value })}
              />
              {o.label}
            </label>
          ))}
        </div>
        {state.time.mode !== 'now' && (
          <div className="time-row">
            <label className="mini-field">
              <span>Data</span>
              <input
                type="date"
                required
                value={state.time.date ?? ''}
                onChange={(e) => actions.setTime({ ...state.time, date: e.target.value })}
              />
            </label>
            <label className="mini-field">
              <span>Horário</span>
              <input
                type="time"
                required
                step={60}
                value={state.time.time ?? ''}
                onChange={(e) => actions.setTime({ ...state.time, time: e.target.value })}
              />
            </label>
          </div>
        )}
        {state.time.mode !== 'now' && (
          <p className="hint">
            {state.time.mode === 'depart_at'
              ? 'Horário local da origem'
              : 'Horário local do destino'}
            {zone ? ` (${zone})` : ' — selecione o local para identificar o fuso.'}
          </p>
        )}
      </fieldset>

      <fieldset className="field-group">
        <legend>Transporte</legend>
        <div className="mode-picker" role="radiogroup" aria-label="Meio de transporte">
          {MODE_CHOICES.map((m) => {
            const why = modeDisabled(m.value);
            return (
              <label
                key={m.value}
                className={`mode-chip ${state.modeChoice === m.value ? 'is-active' : ''} ${why ? 'is-limited' : ''}`}
                title={why ?? undefined}
              >
                <input
                  type="radio"
                  name="mode"
                  value={m.value}
                  checked={state.modeChoice === m.value}
                  onChange={() => actions.setModeChoice(m.value)}
                />
                <ModeIcon mode={m.value === 'compare' ? 'compare' : (m.value as TravelMode)} />
                <span>{m.label}</span>
              </label>
            );
          })}
        </div>
        {capabilities && !capabilities.flights.configured && (
          <p className="hint">
            * Avião: nenhuma fonte de voos configurada no servidor — o modo informará isso em vez de
            exibir voos.
          </p>
        )}
      </fieldset>

      {showMargins && (
        <fieldset className="field-group field-group--margins">
          <legend>Margens no aeroporto (avião)</legend>
          <div className="time-row">
            <label className="mini-field">
              <span>Antes do voo (min)</span>
              <input
                type="number"
                min={0}
                max={600}
                step={5}
                value={state.margins.pre}
                onChange={(e) => actions.setMargins({ pre: clampInt(e.target.value, 0, 600) })}
              />
            </label>
            <label className="mini-field">
              <span>Após o pouso (min)</span>
              <input
                type="number"
                min={0}
                max={300}
                step={5}
                value={state.margins.post}
                onChange={(e) => actions.setMargins({ post: clampInt(e.target.value, 0, 300) })}
              />
            </label>
          </div>
          <p className="hint">
            Definidas por você. Não são tempos oficiais — confira as regras da companhia aérea e do
            aeroporto.
          </p>
        </fieldset>
      )}

      {state.formError && (
        <p className="form-error" role="alert">
          {state.formError}
        </p>
      )}

      <button type="submit" className="primary-btn" disabled={busy} aria-busy={busy}>
        {busy ? (
          <>
            <Spinner /> Calculando…
          </>
        ) : (
          'Calcular rota'
        )}
      </button>
    </form>
  );
}

function clampInt(v: string, min: number, max: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}
