import {
  isValidTimeZone,
  localDateTimeToInstant,
  type PlaceSummary,
  type ResolvedTimeRequest,
  type TimeSelection,
} from '@nexus/shared';

export type TimeResolution =
  | { ok: true; resolved: ResolvedTimeRequest; note?: string }
  | { ok: false; message: string };

/**
 * Converte a escolha do usuário em um instante absoluto:
 * - "Sair às" é interpretado no fuso da ORIGEM;
 * - "Chegar até" é interpretado no fuso do DESTINO.
 * O fuso do dispositivo só é usado para a localização do próprio dispositivo.
 */
export function resolveTimeSelection(
  selection: TimeSelection,
  origin: PlaceSummary,
  destination: PlaceSummary,
  deviceZone: string,
): TimeResolution {
  if (selection.mode === 'now') return { ok: true, resolved: { mode: 'now' } };
  if (!selection.date || !selection.time) return { ok: false, message: 'Informe a data e o horário.' };

  const place = selection.mode === 'depart_at' ? origin : destination;
  const role = selection.mode === 'depart_at' ? 'da origem' : 'do destino';
  let zone = isValidTimeZone(place.timeZone) ? place.timeZone : undefined;
  let note: string | undefined;
  if (!zone && place.source === 'device_geolocation' && isValidTimeZone(deviceZone)) {
    zone = deviceZone;
    note = `Fuso ${role} obtido do seu dispositivo (${deviceZone}).`;
  }
  if (!zone) {
    return { ok: false, message: `Não foi possível determinar o fuso horário ${role}. Tente novamente ou use "Sair agora".` };
  }

  const r = localDateTimeToInstant(selection.date, selection.time, zone);
  if (!r.ok) {
    if (r.reason === 'nonexistent_local_time') {
      return {
        ok: false,
        message: `O horário ${selection.time} não existe em ${selection.date} no fuso ${zone} (mudança de horário de verão). Escolha outro horário.`,
      };
    }
    return { ok: false, message: 'Data ou horário inválido.' };
  }
  return { ok: true, resolved: { mode: selection.mode, instant: r.instant, zone }, note };
}

/** Próximo horário "redondo" (múltiplo de 15 min) no fuso informado, para pré-preencher o campo. */
export function defaultDateTime(now: Date, zone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(now.getTime() + 15 * 60_000));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  const minute = Math.floor(Number(get('minute')) / 15) * 15;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${String(minute).padStart(2, '0')}` };
}
