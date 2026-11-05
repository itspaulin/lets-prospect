import assert from 'node:assert/strict';
import test from 'node:test';
import { acme, createTestDeps } from '../../testing/deps.js';
import { addCompany } from '../../core/use-cases/companies.js';
import { MIGRATIONS } from './migrations.js';
import { migrate } from './sqlite-store.js';

test('histórico é somente inclusão', () => {
  const { deps, db } = createTestDeps();
  addCompany(deps, acme);
  assert.throws(() => db.prepare("UPDATE interactions SET summary = 'x'").run(), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM interactions').run(), /append-only/);
});

test('migrações podem rodar de novo sem efeito', () => {
  const { db } = createTestDeps();
  migrate(db);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n, MIGRATIONS.length);
});

test('falha no meio de uma transação desfaz tudo', () => {
  const { deps } = createTestDeps();
  assert.throws(() =>
    deps.store.transaction(() => {
      addCompany(deps, acme);
      throw new Error('queda simulada');
    }),
  );
  assert.equal(deps.store.companies.all().length, 0);
});

test('banco recusa fato verificado sem fonte mesmo fora do caso de uso', () => {
  const { deps, db } = createTestDeps();
  const { company } = addCompany(deps, acme);
  assert.throws(
    () =>
      db.prepare("INSERT INTO evidences (id, company_id, kind, claim, certainty, stance, observed_at, created_at) VALUES ('e', ?, 'business_model', 'x', 'verified', 'supports', '2026-10-26', '2026-10-26')").run(company.id),
    /CHECK/,
  );
});
