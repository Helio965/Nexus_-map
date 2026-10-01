import { DateTime } from 'luxon';
import type { TimePoint } from '../types/time';
import { calendarDayOffset } from './zonedTime';

const LOCALE = 'pt-BR';

/** "08:37" no fuso do lugar (ou no fuso do navegador/servidor quando não informado). */
export function formatClock(instant: string, zone?: string): string {
  const dt = DateTime.fromISO(instant, { zone: 'utc' }).setZone(zone ?? 'local');
  return dt.toFormat('HH:mm');
}

/** Abreviação/offset do fuso no instante, ex.: "GMT-3", "CEST". */
export function formatZoneAbbrev(instant: string, zone: string): string {
  const dt = DateTime.fromISO(instant, { zone: 'utc' }).setZone(zone).setLocale(LOCALE);
  return dt.offsetNameShort ?? dt.toFormat('ZZ');
}

export function formatDate(instant: string, zone?: string): string {
  return DateTime.fromISO(instant, { zone: 'utc' })
    .setZone(zone ?? 'local')
    .setLocale(LOCALE)
    .toFormat('dd/MM/yyyy');
}

/**
 * Horário com sufixo de dia (+1) relativo a um ponto de referência e, quando o fuso
 * difere do fuso de referência, com a indicação do fuso.
 */
export function formatTimePoint(point: TimePoint, reference?: TimePoint): string {
  let text = formatClock(point.instant, point.timeZone);
  if (reference) {
    const days = calendarDayOffset(reference, point);
    if (days !== 0) text += ` (${days > 0 ? '+' : ''}${days} dia${Math.abs(days) > 1 ? 's' : ''})`;
    if (point.timeZone && reference.timeZone && !sameOffset(point, reference)) {
      text += ` ${formatZoneAbbrev(point.instant, point.timeZone)}`;
    }
  }
  return text;
}

function sameOffset(a: TimePoint, b: TimePoint): boolean {
  if (!a.timeZone || !b.timeZone) return true;
  const oa = DateTime.fromISO(a.instant, { zone: 'utc' }).setZone(a.timeZone).offset;
  const ob = DateTime.fromISO(b.instant, { zone: 'utc' }).setZone(b.timeZone).offset;
  return oa === ob;
}

/** "37 min", "1h45", "4h18", "2 d 3h". Arredonda para o minuto mais próximo. */
export function formatDuration(totalSeconds: number): string {
  const minutesTotal = Math.max(0, Math.round(totalSeconds / 60));
  if (minutesTotal < 60) return `${minutesTotal} min`;
  const days = Math.floor(minutesTotal / 1440);
  const hours = Math.floor((minutesTotal % 1440) / 60);
  const minutes = minutesTotal % 60;
  if (days > 0) return `${days} d ${hours}h${minutes > 0 ? String(minutes).padStart(2, '0') : ''}`;
  return minutes === 0 ? `${hours}h` : `${hours}h${String(minutes).padStart(2, '0')}`;
}

/** "850 m", "24,6 km", "1.234 km". */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  const digits = km < 100 ? 1 : 0;
  return `${km.toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits })} km`;
}

export function formatMoney(amount: number, currencyCode: string): string {
  return amount.toLocaleString(LOCALE, { style: 'currency', currency: currencyCode });
}
