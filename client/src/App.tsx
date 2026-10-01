import {
  FRESHNESS_LABELS,
  formatClock,
  type DataFreshness,
  type LatLng,
  type TrafficSignalFeature,
  type TravelMode,
} from '@nexus/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DataBadge, Notice } from './components/common/ui';
import { RouteForm } from './components/form/RouteForm';
import { BottomSheet } from './components/layout/BottomSheet';
import { SNAP_FRACTION, type SheetSnap } from './components/layout/sheetSnaps';
import type { MapLayerType } from './components/map/LayerSwitcher';
import { MapView, type MapPadding } from './components/map/MapView';
import { ModeCards, ProgressList, RecommendationCard } from './components/results/ModeCards';
import { RouteDetails } from './components/results/RouteDetails';
import { DemoSignalsPanel, SignalsPanel } from './components/signals/SignalsPanel';
import { useCapabilities, useMediaQuery, useOnline } from './hooks/basic';
import { useDemoSignals, useSignalLayer } from './hooks/useSignalLayer';
import { drivePolylineForSignals } from './services/MapService';
import { usePlanner } from './state/usePlanner';

const PANEL_WIDTH = 420;

export default function App() {
  const planner = usePlanner();
  const { state, actions, comparison, recommendation, selectedOption, pending } = planner;
  const caps = useCapabilities();
  const capabilities = caps.status === 'ready' ? caps.data : null;
  const online = useOnline();
  const isMobile = useMediaQuery('(max-width: 899px)');
  const [snap, setSnap] = useState<SheetSnap>('half');
  const [layerType, setLayerType] = useState<MapLayerType>('roadmap');
  const [trafficOn, setTrafficOn] = useState(false);
  const [signalsOn, setSignalsOn] = useState(false);
  const [demoOn, setDemoOn] = useState(false);
  const [focusPoint, setFocusPoint] = useState<LatLng | null>(null);

  // Ao iniciar um cálculo, leva o foco visual para os resultados.
  const resultsRef = useRef<HTMLDivElement>(null);
  const runId = state.run?.id;
  useEffect(() => {
    if (runId === undefined) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    resultsRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  }, [runId]);

  const signalPolyline = drivePolylineForSignals(selectedOption);
  const signals = useSignalLayer(signalPolyline, signalsOn && !demoOn);
  const demo = useDemoSignals(signalPolyline, demoOn && !!capabilities?.signals.demoMode);

  const selectedResult = state.selected ? state.results[state.selected.mode] : undefined;
  const modeOptions = selectedResult && selectedResult !== 'pending' ? selectedResult.options : [];

  const padding = useMemo<MapPadding>(
    () =>
      isMobile
        ? {
            top: 70,
            right: 24,
            left: 24,
            bottom: Math.round(SNAP_FRACTION[snap] * window.innerHeight) + 16,
          }
        : { top: 90, right: 40, bottom: 40, left: PANEL_WIDTH + 48 },
    [isMobile, snap],
  );

  const timeLabel =
    state.run?.resolved.mode === 'arrive_by' && state.run.resolved.instant
      ? `para chegar até ${formatClock(state.run.resolved.instant, state.run.destination.timeZone)}`
      : state.run?.resolved.mode === 'depart_at' && state.run.resolved.instant
        ? `para sair às ${formatClock(state.run.resolved.instant, state.run.origin.timeZone)}`
        : 'para sair agora';

  const panel = (
    <div className="panel">
      <header className="brand">
        <div className="brand__mark" aria-hidden="true">
          <span className="brand__a" />
          <span className="brand__line" />
          <span className="brand__b" />
        </div>
        <div>
          <h1 className="brand__name">Nexus</h1>
          <p className="brand__tag">planejador multimodal · dados reais</p>
        </div>
      </header>

      {!online && (
        <Notice tone="warn">
          Você está sem conexão. As consultas serão retomadas quando a internet voltar.
        </Notice>
      )}
      {caps.status === 'error' && (
        <Notice tone="error">Servidor indisponível ({caps.message}). Tentando reconectar…</Notice>
      )}
      {capabilities && !capabilities.google.serverKeyConfigured && (
        <Notice tone="warn" title="Servidor sem chave da Google Maps Platform">
          Busca de locais e cálculo de rotas ficam indisponíveis até que{' '}
          <code>GOOGLE_MAPS_SERVER_KEY</code> seja configurada (veja o README).
        </Notice>
      )}

      <RouteForm
        state={state}
        capabilities={capabilities}
        busy={pending.length > 0}
        actions={actions}
      />

      <div ref={resultsRef} className="results-anchor" aria-hidden="true" />
      {state.stale && (
        <Notice tone="info">
          Os parâmetros mudaram. Clique em “Calcular rota” para atualizar os resultados.
        </Notice>
      )}
      {state.run?.note && <p className="hint">{state.run.note}</p>}

      <ProgressList pending={pending} />

      {comparison && state.run && state.run.requested.length > 1 && pending.length === 0 && (
        <RecommendationCard
          title={recommendation?.recommendation?.title ?? null}
          reasons={recommendation?.recommendation?.reasons ?? []}
          fallback={recommendation?.reason}
          timeLabel={timeLabel}
        />
      )}

      {comparison && (
        <ModeCards
          comparison={comparison}
          selectedMode={state.selected?.mode ?? null}
          recommendedMode={
            state.run && state.run.requested.length > 1
              ? (recommendation?.recommendation?.mode ?? null)
              : null
          }
          onSelect={(m: TravelMode, id: string) => {
            actions.select(m, id);
            if (isMobile) setSnap('half');
          }}
        />
      )}

      {demoOn && capabilities?.signals.demoMode ? (
        <DemoSignalsPanel data={demo.data} error={demo.error} clockOffsetMs={demo.clockOffsetMs} />
      ) : (
        <SignalsPanel
          layer={signals.layer}
          states={signals.states}
          stream={signals.stream}
          clockOffsetMs={signals.clockOffsetMs}
          onFocus={(f: TrafficSignalFeature) => setFocusPoint({ ...f.location })}
        />
      )}

      {selectedOption && selectedResult && selectedResult !== 'pending' && (
        <RouteDetails
          option={selectedOption}
          result={selectedResult}
          onSelectOption={(id) => actions.select(selectedOption.mode, id)}
          onFocusPoint={(p) => {
            setFocusPoint({ ...p });
            if (isMobile) setSnap('peek');
          }}
        />
      )}

      {state.run &&
        pending.length === 0 &&
        comparison?.entries.every((e) => e.status !== 'available') && (
          <Notice tone="info">
            Nenhum modo retornou uma opção real para este trajeto. Prefiro mostrar isso a exibir uma
            rota inventada.
          </Notice>
        )}

      <footer className="legend">
        <p className="eyebrow">Legenda dos dados</p>
        <ul>
          {(Object.keys(FRESHNESS_LABELS) as DataFreshness[]).map((f) => (
            <li key={f}>
              <DataBadge freshness={f} />
            </li>
          ))}
        </ul>
        <p className="legend__sources">
          Mapas, lugares e rotas: Google Maps Platform. Aeroportos: OurAirports (domínio público).
          Voos: {capabilities?.flights.provider ?? 'não configurado'}. Semáforos: © colaboradores do
          OpenStreetMap (ODbL)
          {capabilities?.signals.hamburgTld
            ? '; telemetria: Freie und Hansestadt Hamburg (TLD, beta)'
            : ''}
          .
        </p>
      </footer>
    </div>
  );

  return (
    <div className="app">
      <a className="skip-link" href="#planner-panel">
        Ir para o painel de rota
      </a>
      <MapView
        layerType={layerType}
        onLayerType={setLayerType}
        trafficOn={trafficOn}
        onTraffic={setTrafficOn}
        signalsOn={signalsOn}
        onSignals={setSignalsOn}
        demoAvailable={!!capabilities?.signals.demoMode}
        demoOn={demoOn}
        onDemo={setDemoOn}
        origin={state.origin.place}
        destination={state.destination.place}
        options={modeOptions}
        selected={selectedOption}
        onSelectOption={(id) => state.selected && actions.select(state.selected.mode, id)}
        signalFeatures={signals.layer.status === 'ready' ? signals.layer.data.features : []}
        signalStates={signals.states}
        signalClockOffsetMs={signals.clockOffsetMs}
        demoFeatures={demo.data?.features ?? []}
        demoClockOffsetMs={demo.clockOffsetMs}
        focusPoint={focusPoint}
        padding={padding}
      />
      {isMobile ? (
        <BottomSheet snap={snap} onSnap={setSnap}>
          <div id="planner-panel">{panel}</div>
        </BottomSheet>
      ) : (
        <aside id="planner-panel" className="side-panel" aria-label="Painel de rota">
          {panel}
        </aside>
      )}
    </div>
  );
}
