import { fileURLToPath } from 'node:url';
import { loadEnv } from '../infra/env.js';
import { createContainer } from '../infra/container.js';
import { buildServer } from './server.js';

const port = Number(process.env.PORT ?? 4380);
const env = loadEnv();
const container = createContainer();
const webDir = fileURLToPath(new URL('../../web/dist', import.meta.url));

// Bound to loopback only: the API has no login, so it must never be reachable from the network.
const app = buildServer(container, {
  info: {
    transport: env.EMAIL_TRANSPORT,
    delivers: container.email.delivers,
    databasePath: env.DATABASE_PATH,
    scoringPath: env.SCORING_CONFIG_PATH,
    sendingPath: env.SENDING_CONFIG_PATH,
    outboxDir: env.OUTBOX_DIR,
    smtp: { host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE, user: env.SMTP_USER, passwordSet: !!env.SMTP_PASSWORD },
  },
  webDir,
  allowedHosts: [`127.0.0.1:${port}`, `localhost:${port}`],
  logger: true,
});

const shutdown = async () => {
  await app.close();
  container.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: '127.0.0.1', port });
console.log(`Prospecção em http://127.0.0.1:${port} (${env.EMAIL_TRANSPORT === 'smtp' ? 'envio real via SMTP' : 'modo simulação: nada sai da máquina'})`);
