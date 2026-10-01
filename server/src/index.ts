import { createApp } from './app';
import { loadDotEnv, parseEnv } from './config/env';
import { createServices } from './container';

loadDotEnv();
const env = parseEnv();
const services = createServices(env);
const app = createApp(services, env);

const server = app.listen(env.PORT, () => {
  const c = services.capabilities;
  console.info(`[nexus] API em http://localhost:${env.PORT}/api`);
  console.info(
    `[nexus] Google (servidor): ${c.google.serverKeyConfigured ? 'configurado' : 'NÃO configurado'} | ` +
      `Voos: ${c.flights.configured ? c.flights.provider : 'NÃO configurado'} | ` +
      `Semáforos: OSM=${c.signals.osm} Hamburgo=${c.signals.hamburgTld} DEMO=${c.signals.demoMode}`,
  );
  if (c.signals.demoMode) console.warn('[nexus] ATENÇÃO: modo demonstração de semáforos ATIVO (dados simulados).');
  if (c.flights.configured) {
    services.airports.load().catch((err) => console.warn('[nexus] base de aeroportos indisponível:', err.message));
  }
});

function shutdown() {
  services.shutdown();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
