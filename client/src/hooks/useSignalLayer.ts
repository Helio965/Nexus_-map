import type { DemoSignalResponse, SignalLayerResponse, SignalStateUpdate } from '@nexus/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, isAbort } from '../api/client';

export type SignalLayerStatus =
  | { status: 'off' }
  | { status: 'no_route' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: SignalLayerResponse };

export type StreamStatus = 'idle' | 'connecting' | 'open' | 'reconnecting';

const RESYNC_MS = 30_000;

type Fetched = { key: string; layer: Extract<SignalLayerStatus, { status: 'error' | 'ready' }> };

/**
 * Camada de semáforos REAL:
 * - busca semáforos ao longo da rota de carro selecionada;
 * - para fluxos com telemetria, abre um EventSource (SSE) e ressincroniza o estado
 *   completo a cada 30 s;
 * - mede a diferença entre o relógio do servidor e o local (serverTime) para que "há X s"
 *   e eventuais contagens regressivas não dependam de um relógio local errado.
 */
export function useSignalLayer(polyline: string | null, enabled: boolean) {
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const [states, setStates] = useState<Record<string, SignalStateUpdate>>({});
  const [streamState, setStreamState] = useState<{ key: string; status: StreamStatus } | null>(null);
  const [clockOffsetMs, setClockOffsetMs] = useState(0);

  useEffect(() => {
    if (!enabled || !polyline) return;
    const controller = new AbortController();
    api
      .signalsAlongRoute(polyline, controller.signal)
      .then((data) => {
        setClockOffsetMs(Date.parse(data.serverTime) - Date.now());
        const initial: Record<string, SignalStateUpdate> = {};
        for (const f of data.features) {
          if (f.telemetry.status !== 'live') continue;
          for (const a of f.telemetry.approaches) {
            initial[a.streamId] = {
              streamId: a.streamId,
              phase: a.phase,
              phaseSince: a.phaseSince,
              receivedAt: a.receivedAt,
              nextChangeAt: a.nextChangeAt,
              stale: a.stale,
            };
          }
        }
        setStates(initial);
        setFetched({ key: polyline, layer: { status: 'ready', data } });
      })
      .catch((err: Error) => {
        if (isAbort(err)) return;
        setFetched({ key: polyline, layer: { status: 'error', message: err.message } });
      });
    return () => controller.abort();
  }, [polyline, enabled]);

  const layer = useMemo<SignalLayerStatus>(
    () =>
      !enabled
        ? { status: 'off' }
        : !polyline
          ? { status: 'no_route' }
          : fetched?.key === polyline
            ? fetched.layer
            : { status: 'loading' },
    [enabled, polyline, fetched],
  );

  const streamKey = useMemo(() => {
    if (layer.status !== 'ready') return '';
    return layer.data.features
      .flatMap((f) => (f.telemetry.status === 'live' ? f.telemetry.approaches.map((a) => a.streamId) : []))
      .join(',');
  }, [layer]);

  useEffect(() => {
    if (!streamKey) return;
    const ids = streamKey.split(',');
    const es = new EventSource(api.signalStreamUrl(ids));
    const onTime = (ev: Event) => {
      try {
        const { serverTime } = JSON.parse((ev as MessageEvent).data) as { serverTime: string };
        setClockOffsetMs(Date.parse(serverTime) - Date.now());
      } catch {
        /* evento sem horário */
      }
    };
    es.addEventListener('hello', (ev) => {
      setStreamState({ key: streamKey, status: 'open' });
      onTime(ev);
    });
    es.addEventListener('ping', onTime);
    es.addEventListener('state', (ev) => {
      const u = JSON.parse((ev as MessageEvent).data) as SignalStateUpdate;
      setStates((prev) => ({ ...prev, [u.streamId]: u }));
    });
    es.onerror = () => setStreamState({ key: streamKey, status: es.readyState === EventSource.CLOSED ? 'idle' : 'reconnecting' });

    // Ressincronização periódica do estado completo.
    const controller = new AbortController();
    const resync = setInterval(() => {
      api
        .signalStates(ids, controller.signal)
        .then((snap) => {
          setClockOffsetMs(Date.parse(snap.serverTime) - Date.now());
          setStates((prev) => {
            const next = { ...prev };
            for (const st of snap.states) next[st.streamId] = st;
            return next;
          });
        })
        .catch(() => undefined);
    }, RESYNC_MS);

    return () => {
      es.close();
      clearInterval(resync);
      controller.abort();
    };
  }, [streamKey]);

  const stream: StreamStatus = !streamKey ? 'idle' : streamState?.key === streamKey ? streamState.status : 'connecting';

  return { layer, states, stream, clockOffsetMs };
}

/** MODO DEMONSTRAÇÃO (dados simulados) — completamente separado da camada real. */
export function useDemoSignals(polyline: string | null, enabled: boolean) {
  const [result, setResult] = useState<{ key: string; data: DemoSignalResponse | null; error: string | null; offset: number } | null>(null);
  const latest = useRef<{ data: DemoSignalResponse | null; offset: number; loading: boolean }>({ data: null, offset: 0, loading: false });

  useEffect(() => {
    if (!enabled || !polyline) return;
    latest.current = { data: null, offset: 0, loading: false };
    const controller = new AbortController();
    const load = () => {
      if (latest.current.loading) return;
      latest.current.loading = true;
      api
        .signalDemo(polyline, controller.signal)
        .then((d) => {
          const offset = Date.parse(d.serverTime) - Date.now();
          latest.current = { data: d, offset, loading: false };
          setResult({ key: polyline, data: d, error: null, offset });
        })
        .catch((err: Error) => {
          latest.current.loading = false;
          if (!isAbort(err)) setResult({ key: polyline, data: null, error: err.message, offset: 0 });
        });
    };
    load();
    const periodic = setInterval(load, 15_000);
    // Quando um "nextChangeAt" simulado vence, sincroniza de novo com o servidor.
    const due = setInterval(() => {
      const { data: d, offset } = latest.current;
      if (d && d.features.some((f) => Date.parse(f.nextChangeAt) <= Date.now() + offset)) load();
    }, 1000);
    return () => {
      controller.abort();
      clearInterval(periodic);
      clearInterval(due);
    };
  }, [polyline, enabled]);

  const current = enabled && polyline && result?.key === polyline ? result : null;
  return { data: current?.data ?? null, error: current?.error ?? null, clockOffsetMs: current?.offset ?? 0 };
}
