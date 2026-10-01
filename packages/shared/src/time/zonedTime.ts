import { DateTime, IANAZone } from 'luxon';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export type LocalToInstantResult =
  | { ok: true; instant: string; offsetMinutes: number }
  | { ok: false; reason: 'invalid_format' | 'invalid_zone' | 'nonexistent_local_time' };

export function isValidTimeZone(zone: string | undefined): zone is string {
  return typeof zone === 'string' && zone.length > 0 && IANAZone.isValidZone(zone);
}

/**
 * Converte um horário de parede ("2026-10-20" + "08:00") em um fuso IANA para um instante UTC.
 *
 * Horários inexistentes (lacuna do horário de verão) são rejeitados em vez de "ajustados"
 * silenciosamente. Em horários ambíguos (fim do horário de verão) o Luxon escolhe a primeira
 * ocorrência, que é o comportamento documentado aqui.
 */
export function localDateTimeToInstant(
  date: string,
  time: string,
  zone: string,
): LocalToInstantResult {
  const d = DATE_RE.exec(date);
  const t = TIME_RE.exec(time);
  if (!d || !t) return { ok: false, reason: 'invalid_format' };
  if (!isValidTimeZone(zone)) return { ok: false, reason: 'invalid_zone' };

  const parts = {
    year: Number(d[1]),
    month: Number(d[2]),
    day: Number(d[3]),
    hour: Number(t[1]),
    minute: Number(t[2]),
  };
  const dt = DateTime.fromObject(parts, { zone });
  if (!dt.isValid) return { ok: false, reason: 'invalid_format' };

  // Se o Luxon precisou mover o horário (lacuna de DST) ou a data não existe (ex.: 31/02),
  // os componentes não batem com o que foi pedido.
  if (
    dt.year !== parts.year ||
    dt.month !== parts.month ||
    dt.day !== parts.day ||
    dt.hour !== parts.hour ||
    dt.minute !== parts.minute
  ) {
    return { ok: false, reason: 'nonexistent_local_time' };
  }
  return { ok: true, instant: dt.toUTC().toISO({ suppressMilliseconds: true })!, offsetMinutes: dt.offset };
}

export interface LocalParts {
  date: string;
  time: string;
}

export function instantToLocalParts(instant: string, zone: string): LocalParts {
  const dt = DateTime.fromISO(instant, { zone: 'utc' }).setZone(zone);
  return { date: dt.toFormat('yyyy-MM-dd'), time: dt.toFormat('HH:mm') };
}

/** Data de hoje (YYYY-MM-DD) no fuso informado. */
export function todayInZone(zone: string, now: Date = new Date()): string {
  return DateTime.fromJSDate(now).setZone(zone).toFormat('yyyy-MM-dd');
}

export function addSeconds(instant: string, seconds: number): string {
  return DateTime.fromISO(instant, { zone: 'utc' })
    .plus({ seconds })
    .toUTC()
    .toISO({ suppressMilliseconds: true })!;
}

/** b − a, em segundos. */
export function diffSeconds(a: string, b: string): number {
  return Math.round(
    DateTime.fromISO(b, { zone: 'utc' }).diff(DateTime.fromISO(a, { zone: 'utc' }), 'seconds')
      .seconds,
  );
}

export function toInstant(date: Date): string {
  return DateTime.fromJSDate(date).toUTC().toISO({ suppressMilliseconds: true })!;
}

/** Arredonda para baixo ao minuto (útil para não prometer chegada além do prazo). */
export function floorToMinute(instant: string): string {
  return DateTime.fromISO(instant, { zone: 'utc' })
    .startOf('minute')
    .toISO({ suppressMilliseconds: true })!;
}

/** Diferença de dias de calendário local entre dois instantes (cada um no seu fuso). */
export function calendarDayOffset(
  from: { instant: string; timeZone?: string },
  to: { instant: string; timeZone?: string },
): number {
  const a = DateTime.fromISO(from.instant, { zone: 'utc' })
    .setZone(from.timeZone ?? 'utc')
    .startOf('day');
  const b = DateTime.fromISO(to.instant, { zone: 'utc' })
    .setZone(to.timeZone ?? from.timeZone ?? 'utc')
    .startOf('day');
  return Math.round(
    DateTime.fromObject({ year: b.year, month: b.month, day: b.day }, { zone: 'utc' }).diff(
      DateTime.fromObject({ year: a.year, month: a.month, day: a.day }, { zone: 'utc' }),
      'days',
    ).days,
  );
}

/** Converte a duração protobuf da Google ("1234s", "12.5s") em segundos inteiros. */
export function parseGoogleDuration(value: string | undefined | null): number | undefined {
  if (!value) return undefined;
  const m = /^(-?\d+(?:\.\d+)?)s$/.exec(value.trim());
  if (!m) return undefined;
  return Math.round(Number(m[1]));
}
