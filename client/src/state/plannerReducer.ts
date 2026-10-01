import type {
  ModeResult,
  PlaceSummary,
  ResolvedTimeRequest,
  TimeSelection,
  TravelMode,
} from '@nexus/shared';

export type ModeChoice = 'compare' | TravelMode;

export interface PlaceField {
  text: string;
  place: PlaceSummary | null;
}

export interface PlannerRun {
  id: number;
  resolved: ResolvedTimeRequest;
  requested: TravelMode[];
  origin: PlaceSummary;
  destination: PlaceSummary;
  note?: string;
}

export interface PlannerState {
  origin: PlaceField;
  destination: PlaceField;
  time: TimeSelection;
  modeChoice: ModeChoice;
  margins: { pre: number; post: number };
  run: PlannerRun | null;
  results: Partial<Record<TravelMode, ModeResult | 'pending'>>;
  formError: string | null;
  /** Parâmetros mudaram depois do último cálculo. */
  stale: boolean;
  selected: { mode: TravelMode; optionId: string } | null;
  userSelected: boolean;
}

export type PlannerAction =
  | { type: 'originText'; text: string }
  | { type: 'originPlace'; place: PlaceSummary | null; text?: string }
  | { type: 'destinationText'; text: string }
  | { type: 'destinationPlace'; place: PlaceSummary | null; text?: string }
  | { type: 'swap' }
  | { type: 'time'; time: TimeSelection }
  | { type: 'modeChoice'; choice: ModeChoice }
  | { type: 'margins'; pre?: number; post?: number }
  | { type: 'formError'; message: string | null }
  | { type: 'start'; run: PlannerRun }
  | { type: 'result'; runId: number; result: ModeResult }
  | { type: 'select'; mode: TravelMode; optionId: string; byUser: boolean };

export function initialPlannerState(time: TimeSelection): PlannerState {
  return {
    origin: { text: '', place: null },
    destination: { text: '', place: null },
    time,
    modeChoice: 'compare',
    margins: { pre: 90, post: 30 },
    run: null,
    results: {},
    formError: null,
    stale: false,
    selected: null,
    userSelected: false,
  };
}

/** Origem/destino mudaram: resultados antigos deixam de valer. */
function clearResults(s: PlannerState): PlannerState {
  return { ...s, run: null, results: {}, selected: null, userSelected: false, stale: false };
}

export function plannerReducer(s: PlannerState, a: PlannerAction): PlannerState {
  switch (a.type) {
    case 'originText':
      return clearResults({ ...s, origin: { text: a.text, place: null }, formError: null });
    case 'originPlace':
      return clearResults({
        ...s,
        origin: { text: a.text ?? a.place?.name ?? '', place: a.place },
        formError: null,
      });
    case 'destinationText':
      return clearResults({ ...s, destination: { text: a.text, place: null }, formError: null });
    case 'destinationPlace':
      return clearResults({
        ...s,
        destination: { text: a.text ?? a.place?.name ?? '', place: a.place },
        formError: null,
      });
    case 'swap':
      return clearResults({ ...s, origin: s.destination, destination: s.origin, formError: null });
    case 'time':
      return { ...s, time: a.time, formError: null, stale: s.run !== null };
    case 'modeChoice':
      return { ...s, modeChoice: a.choice, formError: null, stale: s.run !== null };
    case 'margins':
      return {
        ...s,
        margins: { pre: a.pre ?? s.margins.pre, post: a.post ?? s.margins.post },
        stale: s.run !== null && s.run.requested.includes('flight'),
      };
    case 'formError':
      return { ...s, formError: a.message };
    case 'start':
      return {
        ...s,
        run: a.run,
        results: Object.fromEntries(
          a.run.requested.map((m) => [m, 'pending']),
        ) as PlannerState['results'],
        selected: null,
        userSelected: false,
        formError: null,
        stale: false,
      };
    case 'result':
      if (!s.run || s.run.id !== a.runId) return s; // resposta de um cálculo antigo
      return { ...s, results: { ...s.results, [a.result.mode]: a.result } };
    case 'select':
      return {
        ...s,
        selected: { mode: a.mode, optionId: a.optionId },
        userSelected: s.userSelected || a.byUser,
      };
  }
}
