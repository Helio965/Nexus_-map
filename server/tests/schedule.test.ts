import { diffSeconds } from '@nexus/shared';
import { describe, expect, it } from 'vitest';
import { solveDepartureForArrival } from '../src/services/ScheduleService';
import { validateRequestedTime } from '../src/http/timeValidation';

const NOW = new Date('2026-10-20T09:00:00Z');

describe('solveDepartureForArrival (chegar até, cálculo da última saída)', () => {
  it('converge quando a duração depende do horário de saída', async () => {
    const calls: Array<string | undefined> = [];
    const estimate = async (dep?: string) => {
      calls.push(dep);
      // 40 min agora; 45 min saindo perto das 11:15Z
      return dep ? 2700 : 2400;
    };
    const sol = await solveDepartureForArrival({ deadline: '2026-10-20T12:00:00Z', now: NOW, estimate });
    expect(sol.feasible).toBe(true);
    expect(sol.departure).toBe('2026-10-20T11:15:00Z');
    expect(diffSeconds(sol.departure, '2026-10-20T12:00:00Z')).toBe(2700);
    expect(calls).toEqual([undefined, '2026-10-20T11:20:00Z', '2026-10-20T11:15:00Z']);
  });

  it('para cedo quando a estimativa já é estável', async () => {
    let n = 0;
    const sol = await solveDepartureForArrival({
      deadline: '2026-10-20T12:00:00Z',
      now: NOW,
      estimate: async () => {
        n++;
        return 1800;
      },
    });
    expect(n).toBe(2);
    expect(sol.departure).toBe('2026-10-20T11:30:00Z');
  });

  it('reporta inviável quando a saída necessária já passou', async () => {
    const sol = await solveDepartureForArrival({
      deadline: '2026-10-20T09:20:00Z',
      now: NOW,
      estimate: async () => 1800,
    });
    expect(sol.feasible).toBe(false);
    expect(sol.requiredDeparture).toBe('2026-10-20T08:50:00Z');
    expect(sol.departure).toBe('2026-10-20T09:00:00Z');
  });

  it('respeita o orçamento de chamadas', async () => {
    let n = 0;
    await solveDepartureForArrival({
      deadline: '2026-10-21T12:00:00Z',
      now: NOW,
      maxEstimates: 3,
      estimate: async () => 1000 + 600 * n++,
    });
    expect(n).toBe(3);
  });
});

describe('validateRequestedTime', () => {
  it('aceita "agora" e horários futuros', () => {
    expect(validateRequestedTime({ mode: 'now' }, 'drive', NOW)).toBeNull();
    expect(validateRequestedTime({ mode: 'depart_at', instant: '2026-10-20T10:00:00Z' }, 'drive', NOW)).toBeNull();
  });

  it('recusa horários no passado com mensagem clara', () => {
    expect(validateRequestedTime({ mode: 'depart_at', instant: '2026-10-20T08:00:00Z' }, 'walk', NOW)).toContain('já passou');
    expect(validateRequestedTime({ mode: 'arrive_by', instant: '2026-10-20T08:00:00Z' }, 'rail', NOW)).toContain('já passou');
  });

  it('aplica o limite de 100 dias do transporte público e 1 ano dos voos', () => {
    expect(validateRequestedTime({ mode: 'depart_at', instant: '2027-03-01T10:00:00Z' }, 'rail', NOW)).toContain('100 dias');
    expect(validateRequestedTime({ mode: 'depart_at', instant: '2027-03-01T10:00:00Z' }, 'flight', NOW)).toBeNull();
    expect(validateRequestedTime({ mode: 'depart_at', instant: '2027-11-01T10:00:00Z' }, 'flight', NOW)).toContain('1 ano');
  });
});
