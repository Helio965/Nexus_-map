import { describe, expect, it } from 'vitest';
import {
  addSeconds,
  compareModes,
  recommend,
  selectBestOption,
  type ModeResult,
  type ResolvedTimeRequest,
  type RouteOption,
  type TravelMode,
} from '../src';

const ZONE = 'America/Sao_Paulo';
// "Agora" fixo para os testes: 20/10/2026 06:00 em Brasília (09:00Z).
const NOW = new Date('2026-10-20T09:00:00Z');

function option(
  mode: TravelMode,
  id: string,
  departure: string,
  durationMin: number,
  extra: Partial<RouteOption> = {},
): RouteOption {
  return {
    id,
    mode,
    departure: { instant: departure, timeZone: ZONE },
    arrival: { instant: addSeconds(departure, durationMin * 60), timeZone: ZONE },
    durationSeconds: durationMin * 60,
    traffic: { freshness: 'none' },
    segments: [],
    warnings: [],
    ...extra,
  };
}

function result(mode: TravelMode, options: RouteOption[]): ModeResult {
  return {
    mode,
    status: options.length > 0 ? 'available' : 'unavailable',
    options,
    warnings: [],
    provider: 'test',
    message: options.length === 0 ? 'sem opção' : undefined,
  };
}

// Chegar até 09:00 local (12:00Z)
const ARRIVE_BY_0900: ResolvedTimeRequest = { mode: 'arrive_by', instant: '2026-10-20T12:00:00Z', zone: ZONE };

describe('selectBestOption', () => {
  it('em "chegar até", escolhe a menor duração entre as que cumprem o prazo', () => {
    const a = option('drive', 'a', '2026-10-20T11:10:00Z', 45); // chega 11:55Z
    const b = option('drive', 'b', '2026-10-20T11:20:00Z', 38); // chega 11:58Z
    const late = option('drive', 'late', '2026-10-20T11:40:00Z', 30); // chega 12:10Z (não cumpre)
    expect(selectBestOption([a, late, b], ARRIVE_BY_0900, NOW)?.id).toBe('b');
  });

  it('em empate de duração, prefere sair mais tarde', () => {
    const early = option('rail', 'early', '2026-10-20T10:50:00Z', 50);
    const later = option('rail', 'later', '2026-10-20T11:05:00Z', 50);
    expect(selectBestOption([early, later], ARRIVE_BY_0900, NOW)?.id).toBe('later');
  });

  it('se nenhuma cumpre o prazo, devolve a que chega mais cedo', () => {
    const x = option('walk', 'x', '2026-10-20T11:30:00Z', 90);
    const y = option('walk', 'y', '2026-10-20T11:00:00Z', 100);
    expect(selectBestOption([x, y], ARRIVE_BY_0900, NOW)?.id).toBe('y');
  });

  it('em "sair às", escolhe a que chega mais cedo', () => {
    const t: ResolvedTimeRequest = { mode: 'depart_at', instant: '2026-10-20T11:00:00Z', zone: ZONE };
    const fast = option('rail', 'fast', '2026-10-20T11:07:00Z', 39); // 11:46
    const slow = option('rail', 'slow', '2026-10-20T11:00:00Z', 52); // 11:52
    expect(selectBestOption([slow, fast], t, NOW)?.id).toBe('fast');
  });
});

describe('compareModes + recommend', () => {
  it('reproduz o cenário "CHEGAR ATÉ 09:00" e destaca quem atende ao prazo', () => {
    const results = {
      drive: result('drive', [option('drive', 'd0', '2026-10-20T11:04:00Z', 38, { traffic: { freshness: 'predicted', delaySeconds: 360 } })]),
      rail: result('rail', [option('rail', 'r0', '2026-10-20T11:00:00Z', 51, { transfers: 1 })]),
      walk: result('walk', [option('walk', 'w0', '2026-10-20T10:46:00Z', 134 + 74)]),
      flight: result('flight', []),
    };
    const cmp = compareModes(results, ARRIVE_BY_0900, ZONE, NOW);
    const byMode = Object.fromEntries(cmp.entries.map((e) => [e.mode, e]));

    expect(byMode.drive!.meetsDeadline).toBe(true);
    expect(byMode.drive!.slackSeconds).toBe(18 * 60);
    expect(byMode.rail!.meetsDeadline).toBe(true);
    expect(byMode.walk!.meetsDeadline).toBe(false);
    expect(byMode.flight!.status).toBe('unavailable');
    expect(byMode.flight!.message).toBe('sem opção');

    const { recommendation } = recommend(cmp);
    expect(recommendation?.mode).toBe('drive');
    expect(recommendation?.reasons[0]).toBe('chega às 08:42, antes do limite de 09:00');
    expect(recommendation?.reasons[1]).toContain('menor duração estimada');
    expect(recommendation?.reasons[1]).toContain('38 min contra 51 min de Metrô / trilhos');
    expect(recommendation?.reasons).toContain('inclui 6 min de atraso estimado por trânsito (Routes API)');
  });

  it('marca como não atendida quando a saída necessária já passou', () => {
    const t: ResolvedTimeRequest = { mode: 'arrive_by', instant: '2026-10-20T09:30:00Z', zone: ZONE };
    const results = { drive: result('drive', [option('drive', 'd', '2026-10-20T08:50:00Z', 38)]) };
    const cmp = compareModes(results, t, ZONE, NOW);
    const drive = cmp.entries.find((e) => e.mode === 'drive')!;
    expect(drive.departureInPast).toBe(true);
    expect(drive.meetsDeadline).toBe(false);
    const rec = recommend(cmp);
    expect(rec.recommendation).toBeNull();
    expect(rec.reason).toBe('Nenhuma opção disponível chega até 06:30.');
  });

  it('em "sair agora", recomenda quem chega primeiro e explica com os horários', () => {
    const t: ResolvedTimeRequest = { mode: 'now' };
    const results = {
      drive: result('drive', [option('drive', 'd', '2026-10-20T09:00:00Z', 37)]),
      walk: result('walk', [option('walk', 'w', '2026-10-20T09:00:00Z', 258)]),
    };
    const cmp = compareModes(results, t, ZONE, NOW);
    const { recommendation } = recommend(cmp);
    expect(recommendation?.mode).toBe('drive');
    expect(recommendation?.reasons[0]).toBe(
      'chega mais cedo entre as opções disponíveis (06:37 contra 10:18 de A pé)',
    );
  });

  it('não recomenda nada quando nenhum modo tem rota real', () => {
    const cmp = compareModes(
      { drive: result('drive', []), rail: result('rail', []) },
      { mode: 'now' },
      ZONE,
      NOW,
    );
    expect(recommend(cmp)).toEqual({
      recommendation: null,
      reason: 'Nenhum modo de transporte retornou uma opção real para este trajeto.',
    });
  });

  it('mantém modos pendentes e não solicitados como tais (sem inventar resultado)', () => {
    const cmp = compareModes({ drive: 'pending' }, { mode: 'now' }, ZONE, NOW);
    expect(cmp.entries.map((e) => [e.mode, e.status])).toEqual([
      ['drive', 'pending'],
      ['walk', 'not_requested'],
      ['rail', 'not_requested'],
      ['flight', 'not_requested'],
    ]);
    expect(recommend(cmp).reason).toBe('Aguardando os resultados dos modos de transporte.');
  });

  it('propaga erro de provedor como erro (não como "sem rota")', () => {
    const err: ModeResult = {
      mode: 'rail',
      status: 'error',
      message: 'Falha ao consultar a Routes API.',
      options: [],
      warnings: [],
      provider: 'Google Routes API',
    };
    const cmp = compareModes({ rail: err }, { mode: 'now' }, ZONE, NOW);
    expect(cmp.entries[2]).toMatchObject({ mode: 'rail', status: 'error', message: 'Falha ao consultar a Routes API.' });
  });
});
