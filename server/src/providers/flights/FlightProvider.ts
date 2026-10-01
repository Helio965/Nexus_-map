/**
 * Contrato para fontes de horários de voo. Permite trocar a AeroAPI por outro fornecedor
 * (Cirium, OAG, AeroDataBox…) sem alterar o FlightService nem a interface.
 */
export interface DirectFlightQuery {
  originIata: string;
  destinationIata: string;
  /** Janela de horários de SAÍDA (UTC, inclusive). */
  departureWindowStart: string;
  departureWindowEnd: string;
}

/** Voo direto publicado por uma fonte real. Horários em UTC. */
export interface ScheduledFlight {
  ident: string;
  identIata?: string;
  /** Voo do operador quando `ident` é codeshare. */
  operatorIdent?: string;
  aircraftType?: string;
  originIata: string;
  destinationIata: string;
  scheduledOut: string;
  scheduledIn: string;
  isCodeshare: boolean;
}

export interface FlightProvider {
  readonly id: string;
  readonly name: string;
  readonly configured: boolean;
  /** Janela máxima aceita entre início e fim da busca (ms). */
  readonly maxWindowMs: number;
  /** Até quando no futuro a fonte publica horários (ms a partir de agora). */
  readonly maxFutureMs: number;
  searchDirectFlights(query: DirectFlightQuery, signal?: AbortSignal): Promise<ScheduledFlight[]>;
}

/** Usado quando não há credencial: nunca retorna voos, e o serviço informa "não configurado". */
export class UnconfiguredFlightProvider implements FlightProvider {
  readonly id = 'none';
  readonly name = 'Nenhum provedor de voos configurado';
  readonly configured = false;
  readonly maxWindowMs = 0;
  readonly maxFutureMs = 0;

  async searchDirectFlights(): Promise<ScheduledFlight[]> {
    return [];
  }
}
