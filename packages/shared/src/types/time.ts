export type TimeMode = 'now' | 'depart_at' | 'arrive_by';

/** O que o usuário escolheu na interface (horário de parede, sem fuso). */
export interface TimeSelection {
  mode: TimeMode;
  /** YYYY-MM-DD */
  date?: string;
  /** HH:mm */
  time?: string;
}

/**
 * Horário já resolvido para um instante absoluto.
 * - depart_at: interpretado no fuso da ORIGEM.
 * - arrive_by: interpretado no fuso do DESTINO.
 */
export interface ResolvedTimeRequest {
  mode: TimeMode;
  /** ISO 8601 em UTC. Obrigatório para depart_at e arrive_by. */
  instant?: string;
  /** Fuso IANA usado na interpretação. */
  zone?: string;
}

/** Um instante e o fuso do lugar onde ele acontece (para exibição local correta). */
export interface TimePoint {
  instant: string;
  timeZone?: string;
}
