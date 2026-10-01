import {
  compareModes,
  haversineMeters,
  recommend,
  selectBestOption,
  TRAVEL_MODES,
  type FlightRouteRequest,
  type ModeResult,
  type RouteOption,
  type RouteRequest,
  type TravelMode,
} from '@nexus/shared';
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { api, ApiError, isAbort } from '../api/client';
import { defaultDateTime, resolveTimeSelection } from './timeResolution';
import {
  initialPlannerState,
  plannerReducer,
  type ModeChoice,
  type PlannerState,
} from './plannerReducer';

export const deviceTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function usePlanner() {
  const [state, dispatch] = useReducer(plannerReducer, undefined, () => {
    const d = defaultDateTime(new Date(), deviceTimeZone());
    return initialPlannerState({ mode: 'now', date: d.date, time: d.time });
  });
  const controllerRef = useRef<AbortController | null>(null);
  const runCounter = useRef(0);

  // Origem/destino mudaram → cancela qualquer cálculo em andamento.
  useEffect(() => {
    controllerRef.current?.abort();
  }, [state.origin.place, state.destination.place]);
  useEffect(() => () => controllerRef.current?.abort(), []);

  const calculate = useCallback(async () => {
    const origin = state.origin.place;
    const destination = state.destination.place;
    if (!origin) {
      dispatch({
        type: 'formError',
        message: state.origin.text
          ? 'Selecione a origem na lista de sugestões (endereço validado).'
          : 'Informe a origem.',
      });
      return;
    }
    if (!destination) {
      dispatch({
        type: 'formError',
        message: state.destination.text
          ? 'Selecione o destino na lista de sugestões (endereço validado).'
          : 'Informe o destino.',
      });
      return;
    }
    if (
      (origin.id && origin.id === destination.id) ||
      haversineMeters(origin.location, destination.location) <= 5
    ) {
      dispatch({ type: 'formError', message: 'Origem e destino são o mesmo local.' });
      return;
    }
    const time = resolveTimeSelection(state.time, origin, destination, deviceTimeZone());
    if (!time.ok) {
      dispatch({ type: 'formError', message: time.message });
      return;
    }
    if (time.resolved.instant && new Date(time.resolved.instant).getTime() < Date.now() - 120_000) {
      dispatch({
        type: 'formError',
        message: 'O horário escolhido já passou. Escolha um horário futuro ou "Sair agora".',
      });
      return;
    }

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const id = ++runCounter.current;
    const requested: TravelMode[] =
      state.modeChoice === 'compare' ? [...TRAVEL_MODES] : [state.modeChoice];
    dispatch({
      type: 'start',
      run: { id, resolved: time.resolved, requested, origin, destination, note: time.note },
    });

    const base: RouteRequest = { origin, destination, time: time.resolved };
    await Promise.all(
      requested.map(async (mode) => {
        const body: RouteRequest | FlightRouteRequest =
          mode === 'flight'
            ? {
                ...base,
                preDepartureMarginMinutes: state.margins.pre,
                postArrivalMarginMinutes: state.margins.post,
              }
            : base;
        try {
          const result = await api.route(mode, body, controller.signal);
          dispatch({ type: 'result', runId: id, result });
        } catch (err) {
          if (isAbort(err)) return;
          const apiErr = err instanceof ApiError ? err : null;
          const result: ModeResult = {
            mode,
            status: apiErr?.code === 'VALIDATION' ? 'unavailable' : 'error',
            message: apiErr?.message ?? 'Falha inesperada ao calcular esta opção.',
            options: [],
            warnings: [],
            provider: '',
          };
          dispatch({ type: 'result', runId: id, result });
        }
      }),
    );
  }, [state.origin, state.destination, state.time, state.modeChoice, state.margins]);

  const comparison = useMemo(
    () =>
      state.run
        ? compareModes(state.results, state.run.resolved, state.run.destination.timeZone)
        : null,
    [state.run, state.results],
  );
  const recommendation = useMemo(() => (comparison ? recommend(comparison) : null), [comparison]);

  // Seleção automática: recomendação (quando houver) ou a melhor opção disponível.
  useEffect(() => {
    if (!state.run || state.userSelected) return;
    const target = autoTarget(state, recommendation?.recommendation ?? null);
    if (
      target &&
      (target.mode !== state.selected?.mode || target.optionId !== state.selected?.optionId)
    ) {
      dispatch({ type: 'select', ...target, byUser: false });
    }
  }, [state, recommendation]);

  const selectedOption = useMemo<RouteOption | null>(() => {
    if (!state.selected) return null;
    const r = state.results[state.selected.mode];
    if (!r || r === 'pending') return null;
    return r.options.find((o) => o.id === state.selected!.optionId) ?? null;
  }, [state.selected, state.results]);

  const actions = useMemo(
    () => ({
      calculate,
      setOriginText: (text: string) => dispatch({ type: 'originText', text }),
      setOriginPlace: (place: PlannerState['origin']['place'], text?: string) =>
        dispatch({ type: 'originPlace', place, text }),
      setDestinationText: (text: string) => dispatch({ type: 'destinationText', text }),
      setDestinationPlace: (place: PlannerState['destination']['place'], text?: string) =>
        dispatch({ type: 'destinationPlace', place, text }),
      swap: () => dispatch({ type: 'swap' }),
      setTime: (time: PlannerState['time']) => dispatch({ type: 'time', time }),
      setModeChoice: (choice: ModeChoice) => dispatch({ type: 'modeChoice', choice }),
      setMargins: (m: { pre?: number; post?: number }) => dispatch({ type: 'margins', ...m }),
      select: (mode: TravelMode, optionId: string) =>
        dispatch({ type: 'select', mode, optionId, byUser: true }),
      setFormError: (message: string | null) => dispatch({ type: 'formError', message }),
    }),
    [calculate],
  );

  const pending = state.run
    ? state.run.requested.filter((m) => state.results[m] === 'pending')
    : [];

  return { state, actions, comparison, recommendation, selectedOption, pending };
}

function autoTarget(
  state: PlannerState,
  rec: { mode: TravelMode; optionId: string } | null,
): { mode: TravelMode; optionId: string } | null {
  if (!state.run) return null;
  const allDone = state.run.requested.every((m) => state.results[m] !== 'pending');
  if (rec && allDone) return { mode: rec.mode, optionId: rec.optionId };
  // Enquanto chegam os resultados, mostra a primeira opção disponível (na ordem dos modos).
  for (const mode of state.run.requested) {
    const r = state.results[mode];
    if (r && r !== 'pending' && r.options.length > 0) {
      const best = selectBestOption(r.options, state.run.resolved);
      if (best) return { mode, optionId: best.id };
    }
  }
  return null;
}
