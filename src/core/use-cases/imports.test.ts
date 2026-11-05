import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestDeps } from '../../testing/deps.js';
import { importCompanies, importContacts } from './imports.js';

const companies = [
  { name: 'Acme', website: 'acme.dev', country: 'GB', employees: '20', technologies: 'React; Node.js', source: 'https://clutch.co/acme' },
  { name: 'Beta', website: 'beta.io', country: 'Narnia' },
  { name: 'Acme again', website: 'https://www.acme.dev', country: 'GB' },
  { name: 'Gamma', website: 'gamma.com', country: 'US', employees: 'vinte' },
];

test('importa empresas linha a linha, relatando erros e duplicadas', () => {
  const { deps } = createTestDeps();
  const report = importCompanies(deps, companies);
  assert.deepEqual(report.created.map((item) => item.line), [2]);
  assert.deepEqual(report.skipped.map((item) => item.line), [4]);
  assert.deepEqual(report.failed.map((item) => item.line), [3, 5]);
  assert.deepEqual(deps.store.companies.findByDomain('acme.dev')!.technologies, ['React', 'Node.js']);
});

test('reimportar o mesmo arquivo não duplica nada', () => {
  const { deps } = createTestDeps();
  importCompanies(deps, companies);
  const second = importCompanies(deps, companies);
  assert.equal(second.created.length, 0);
  assert.equal(deps.store.companies.all().length, 1);
});

test('importa contatos associando pelo domínio da empresa', () => {
  const { deps } = createTestDeps();
  importCompanies(deps, companies);
  const report = importContacts(deps, [
    { company: 'acme.dev', name: 'Jane', role: 'CTO', email: 'jane@acme.dev', source: 'https://acme.dev/team' },
    { company: 'unknown.dev', name: 'Bob' },
    { company: 'acme.dev', name: 'Ana', email: 'ana@acme.dev' },
  ]);
  assert.equal(report.created.length, 1);
  assert.match(report.failed[0]!.error, /não encontrada/);
  assert.match(report.failed[1]!.error, /--source/);
});
