import type { Capabilities } from '@nexus/shared';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { api } from '../api/client';

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', cb);
      return () => mql.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Relógio que atualiza a cada `intervalMs` (para "há X s" e contagens regressivas). */
export function useNow(intervalMs = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs, enabled]);
  return now;
}

export type CapabilitiesState =
  | { status: 'loading' }
  | { status: 'ready'; data: Capabilities }
  | { status: 'error'; message: string };

export function useCapabilities(): CapabilitiesState {
  const [state, setState] = useState<CapabilitiesState>({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      api
        .capabilities(controller.signal)
        .then((data) => setState({ status: 'ready', data }))
        .catch((err: Error) => {
          if (controller.signal.aborted) return;
          setState({ status: 'error', message: err.message });
          // Reconexão com espera crescente (servidor reiniciando, rede instável…).
          timer = setTimeout(load, Math.min(30_000, 2_000 * 2 ** attempt++));
        });
    };
    load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);
  return state;
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('online', cb);
      window.addEventListener('offline', cb);
      return () => {
        window.removeEventListener('online', cb);
        window.removeEventListener('offline', cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}
