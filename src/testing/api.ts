import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer, CLIENT_HEADER } from '../api/server.js';
import { createTestDeps, SCORING_PATH, SENDING_PATH } from './deps.js';

// API under test with an in-memory database and throwaway copies of the config files, so saving
// settings in a test never touches config/.
export const createTestApi = (start?: string) => {
  const context = createTestDeps(start);
  const dir = mkdtempSync(join(tmpdir(), 'prospeccao-api-'));
  const scoringPath = join(dir, 'scoring.json');
  const sendingPath = join(dir, 'sending.json');
  copyFileSync(SCORING_PATH, scoringPath);
  copyFileSync(SENDING_PATH, sendingPath);
  const app = buildServer(context.deps, {
    info: {
      transport: 'outbox',
      delivers: false,
      databasePath: ':memory:',
      scoringPath,
      sendingPath,
      outboxDir: join(dir, 'outbox'),
      smtp: { port: 465, secure: true, passwordSet: false },
    },
    allowedHosts: ['127.0.0.1:4317'],
  });
  const send = (method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, payload?: unknown) =>
    app.inject({ method, url, payload: payload as never, headers: { host: '127.0.0.1:4317', [CLIENT_HEADER]: '1' } });
  return { ...context, app, send, scoringPath, sendingPath };
};
