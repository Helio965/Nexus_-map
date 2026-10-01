import { describe, expect, it } from 'vitest';
import {
  addSeconds,
  calendarDayOffset,
  diffSeconds,
  floorToMinute,
  formatDistance,
  formatDuration,
  formatTimePoint,
  instantToLocalParts,
  isValidTimeZone,
  localDateTimeToInstant,
  parseGoogleDuration,
} from '../src';

describe('localDateTimeToInstant', () => {
  it('converte horário de Brasília (UTC−3, sem horário de verão) para UTC', () => {
    const r = localDateTimeToInstant('2026-10-20', '08:00', 'America/Sao_Paulo');
    expect(r).toEqual({ ok: true, instant: '2026-10-20T11:00:00Z', offsetMinutes: -180 });
  });

  it('respeita o horário de verão europeu (Hamburgo, CEST = UTC+2 em julho)', () => {
    const r = localDateTimeToInstant('2026-07-01', '08:00', 'Europe/Berlin');
    expect(r.ok && r.instant).toBe('2026-07-01T06:00:00Z');
  });

  it('respeita o horário padrão europeu (CET = UTC+1 em dezembro)', () => {
    const r = localDateTimeToInstant('2026-12-01', '08:00', 'Europe/Berlin');
    expect(r.ok && r.instant).toBe('2026-12-01T07:00:00Z');
  });

  it('rejeita horário inexistente na lacuna do horário de verão (Nova York, 08/03/2026 02:30)', () => {
    const r = localDateTimeToInstant('2026-03-08', '02:30', 'America/New_York');
    expect(r).toEqual({ ok: false, reason: 'nonexistent_local_time' });
  });

  it('rejeita data inexistente', () => {
    expect(localDateTimeToInstant('2026-02-31', '10:00', 'UTC')).toEqual({
      ok: false,
      reason: 'invalid_format',
    });
  });

  it('rejeita formato inválido e fuso inválido', () => {
    expect(localDateTimeToInstant('20/10/2026', '08:00', 'UTC')).toEqual({
      ok: false,
      reason: 'invalid_format',
    });
    expect(localDateTimeToInstant('2026-10-20', '8h', 'UTC')).toEqual({
      ok: false,
      reason: 'invalid_format',
    });
    expect(localDateTimeToInstant('2026-10-20', '08:00', 'Mars/Olympus')).toEqual({
      ok: false,
      reason: 'invalid_zone',
    });
  });
});

describe('fusos horários', () => {
  it('valida identificadores IANA', () => {
    expect(isValidTimeZone('America/Sao_Paulo')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
  });

  it('mostra o mesmo instante em horários locais diferentes', () => {
    const instant = '2026-10-20T17:10:00Z';
    expect(instantToLocalParts(instant, 'America/Sao_Paulo')).toEqual({
      date: '2026-10-20',
      time: '14:10',
    });
    expect(instantToLocalParts(instant, 'Europe/Lisbon')).toEqual({
      date: '2026-10-20',
      time: '18:10',
    });
    expect(instantToLocalParts(instant, 'Asia/Tokyo')).toEqual({
      date: '2026-10-21',
      time: '02:10',
    });
  });

  it('calcula a diferença de dia de calendário entre fusos (voo noturno)', () => {
    const dep = { instant: '2026-10-20T23:30:00Z', timeZone: 'America/Sao_Paulo' }; // 20:30 local
    const arr = { instant: '2026-10-21T10:00:00Z', timeZone: 'Europe/Lisbon' }; // 11:00 do dia 21
    expect(calendarDayOffset(dep, arr)).toBe(1);
    expect(formatTimePoint(arr, dep)).toMatch(/^11:00 \(\+1 dia\) /);
  });

  it('não acrescenta sufixo quando dia e offset são iguais', () => {
    const a = { instant: '2026-10-20T11:00:00Z', timeZone: 'America/Sao_Paulo' };
    const b = { instant: '2026-10-20T11:37:00Z', timeZone: 'America/Sao_Paulo' };
    expect(formatTimePoint(b, a)).toBe('08:37');
  });
});

describe('aritmética de instantes', () => {
  it('soma e subtrai segundos', () => {
    expect(addSeconds('2026-10-20T11:00:00Z', 2220)).toBe('2026-10-20T11:37:00Z');
    expect(diffSeconds('2026-10-20T11:00:00Z', '2026-10-20T11:37:00Z')).toBe(2220);
    expect(diffSeconds('2026-10-20T11:37:00Z', '2026-10-20T11:00:00Z')).toBe(-2220);
  });

  it('arredonda para baixo ao minuto', () => {
    expect(floorToMinute('2026-10-20T11:00:59Z')).toBe('2026-10-20T11:00:00Z');
  });

  it('interpreta durações protobuf da Google', () => {
    expect(parseGoogleDuration('2280s')).toBe(2280);
    expect(parseGoogleDuration('12.6s')).toBe(13);
    expect(parseGoogleDuration('')).toBeUndefined();
    expect(parseGoogleDuration('PT5M')).toBeUndefined();
  });
});

describe('formatação', () => {
  it('formata durações como no painel', () => {
    expect(formatDuration(37 * 60)).toBe('37 min');
    expect(formatDuration(105 * 60)).toBe('1h45');
    expect(formatDuration(4 * 3600 + 18 * 60)).toBe('4h18');
    expect(formatDuration(2 * 3600)).toBe('2h');
    expect(formatDuration(26 * 3600 + 5 * 60)).toBe('1 d 2h05');
  });

  it('formata distâncias em pt-BR', () => {
    expect(formatDistance(850)).toBe('850 m');
    expect(formatDistance(24_600)).toBe('24,6 km');
  });
});
