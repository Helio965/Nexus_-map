import mqtt, { type MqttClient } from 'mqtt';
import { HttpsProxyAgent } from 'https-proxy-agent';

export interface TldObservation {
  phenomenonTime?: string;
  resultTime?: string;
  result?: number;
}

type Listener = (datastreamId: number, obs: TldObservation) => void;

const TOPIC_RE = /Datastreams\((\d+)\)\/Observations$/;

/**
 * Cliente MQTT compartilhado para o broker do Hamburg TLD. Assina somente os datastreams
 * pedidos pelos clientes conectados (contagem de referências) e desconecta quando ninguém
 * mais precisa — não carrega dados da cidade inteira.
 */
export class HamburgMqttBridge {
  private client: MqttClient | null = null;
  private readonly listeners = new Map<number, Set<Listener>>();
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly url: string,
    private readonly proxyUrl?: string,
    private readonly apiVersion = 'v1.1',
  ) {}

  get connected(): boolean {
    return this.client?.connected ?? false;
  }

  subscribe(datastreamId: number, listener: Listener): () => void {
    let set = this.listeners.get(datastreamId);
    if (!set) {
      set = new Set();
      this.listeners.set(datastreamId, set);
      this.ensureClient().subscribe(this.topic(datastreamId), { qos: 0 });
    }
    set.add(listener);
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    return () => this.unsubscribe(datastreamId, listener);
  }

  close(): void {
    this.client?.end(true);
    this.client = null;
    this.listeners.clear();
  }

  private unsubscribe(datastreamId: number, listener: Listener): void {
    const set = this.listeners.get(datastreamId);
    if (!set) return;
    set.delete(listener);
    if (set.size === 0) {
      this.listeners.delete(datastreamId);
      this.client?.unsubscribe(this.topic(datastreamId));
    }
    if (this.listeners.size === 0 && !this.idleTimer) {
      this.idleTimer = setTimeout(() => {
        this.idleTimer = null;
        if (this.listeners.size === 0) {
          this.client?.end(true);
          this.client = null;
        }
      }, 60_000);
      this.idleTimer.unref?.();
    }
  }

  private topic(id: number): string {
    return `${this.apiVersion}/Datastreams(${id})/Observations`;
  }

  private ensureClient(): MqttClient {
    if (this.client) return this.client;
    const agent = this.proxyUrl ? new HttpsProxyAgent(this.proxyUrl) : undefined;
    const client = mqtt.connect(this.url, {
      reconnectPeriod: 5_000,
      connectTimeout: 15_000,
      clean: true,
      ...(agent ? { wsOptions: { agent } } : {}),
    });
    client.on('connect', () => {
      console.info('[hamburg-tld mqtt] conectado');
      // Reassina tudo após reconexão.
      const topics = [...this.listeners.keys()].map((id) => this.topic(id));
      if (topics.length > 0) client.subscribe(topics, { qos: 0 });
    });
    client.on('message', (topic, payload) => {
      const m = TOPIC_RE.exec(topic);
      if (!m) return;
      const id = Number(m[1]);
      let obs: TldObservation;
      try {
        obs = JSON.parse(payload.toString()) as TldObservation;
      } catch {
        return;
      }
      for (const l of this.listeners.get(id) ?? []) l(id, obs);
    });
    client.on('error', (err) => console.warn('[hamburg-tld mqtt]', err.message));
    client.on('offline', () => console.warn('[hamburg-tld mqtt] offline; usando consulta periódica (REST) até reconectar'));
    this.client = client;
    return client;
  }
}
