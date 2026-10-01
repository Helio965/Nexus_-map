import {
  DEMO_SIGNAL_BANNER,
  pointAlongPath,
  toInstant,
  type DemoSignalFeature,
  type DemoSignalResponse,
  type SignalPhase,
} from '@nexus/shared';
import type { RouteGeometry } from '../TrafficSignalProvider';

/**
 * ⚠ MODO DEMONSTRAÇÃO — DADOS SIMULADOS ⚠
 *
 * Existe apenas para desenvolver/testar a interface de contagem regressiva sem uma fonte
 * real que publique tempo restante. Fica DESLIGADO por padrão (TRAFFIC_SIGNAL_DEMO_MODE),
 * usa endpoint próprio, não aparece em `TrafficSignalService.alongRoute` e todo item tem
 * `simulated: true`. Os pontos são colocados em distâncias fixas da rota — NÃO em semáforos
 * reais — para não sugerir que representam um cruzamento existente.
 */
const CYCLE: Array<{ phase: SignalPhase; seconds: number }> = [
  { phase: 'green', seconds: 25 },
  { phase: 'amber', seconds: 3 },
  { phase: 'red', seconds: 30 },
  { phase: 'red_amber', seconds: 2 },
];
const CYCLE_LENGTH = CYCLE.reduce((a, c) => a + c.seconds, 0);

export function simulatedPhaseAt(epochMs: number, offsetSeconds: number): { phase: SignalPhase; nextChangeMs: number } {
  const t = Math.floor(epochMs / 1000) + offsetSeconds;
  let pos = ((t % CYCLE_LENGTH) + CYCLE_LENGTH) % CYCLE_LENGTH;
  for (const step of CYCLE) {
    if (pos < step.seconds) {
      return { phase: step.phase, nextChangeMs: (Math.floor(epochMs / 1000) + (step.seconds - pos)) * 1000 };
    }
    pos -= step.seconds;
  }
  return { phase: 'green', nextChangeMs: epochMs };
}

export class DemoTrafficSignalProvider {
  constructor(private readonly now: () => Date = () => new Date()) {}

  simulateAlongRoute(route: RouteGeometry): DemoSignalResponse {
    const nowDate = this.now();
    const count = Math.min(8, Math.max(1, Math.floor(route.lengthMeters / 500)));
    const features: DemoSignalFeature[] = [];
    for (let i = 0; i < count; i++) {
      const at = ((i + 1) * route.lengthMeters) / (count + 1);
      const location = pointAlongPath(route.path, at)!;
      const { phase, nextChangeMs } = simulatedPhaseAt(nowDate.getTime(), i * 13);
      features.push({
        id: `demo:${i}`,
        location,
        label: `DEMO ${i + 1} — simulado`,
        phase,
        nextChangeAt: toInstant(new Date(nextChangeMs)),
        simulated: true,
      });
    }
    return { simulated: true, banner: DEMO_SIGNAL_BANNER, features, serverTime: toInstant(nowDate) };
  }
}
