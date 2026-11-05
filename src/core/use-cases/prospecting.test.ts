import assert from 'node:assert/strict';
import test from 'node:test';
import type { DiscoveredCompany, DiscoverQuery, EmailFinder, FoundContact, LeadSource } from '../ports/prospecting.js';
import { acme, createTestDeps } from '../../testing/deps.js';
import { DomainError } from '../errors.js';
import { addCompany } from './companies.js';
import { addContact } from './contacts.js';
import { discoverCompanies, findContacts, runProspecting } from './prospecting.js';
import { erasePersonalData } from './privacy.js';
import { suppressDomain } from './suppressions.js';

const setup = (found: Record<string, FoundContact[]> = {}, discovered: DiscoveredCompany[] = [{ domain: 'www.beta.dev', name: 'Beta' }, { domain: 'acme.dev', name: 'Acme' }, { domain: 'gone.io', name: 'Gone' }], credits = 10) => {
  const ctx = createTestDeps();
  let balance = credits;
  const queries: DiscoverQuery[] = [];
  const searched: string[] = [];
  const leads: LeadSource = { name: 'fake', discover: async (query) => (queries.push(query), discovered) };
  const finder: EmailFinder = {
    name: 'fake',
    creditsRemaining: async () => balance,
    findDecisionMakers: async (domain) => {
      searched.push(domain);
      const result = found[domain] ?? [];
      if (result.length) balance -= 1;
      return result;
    },
  };
  ctx.deps.prospecting = { leads, finder };
  return { ...ctx, queries, searched, balance: () => balance };
};

const jane: FoundContact = { email: 'jane@beta.dev', name: 'Jane Doe', role: 'CTO', verification: 'valid', sources: ['https://beta.dev/team'] };

test('sem HUNTER_API_KEY avisa em vez de falhar', async () => {
  const { deps } = createTestDeps();
  await assert.rejects(discoverCompanies(deps, { country: 'GB' }), (error) => error instanceof DomainError && error.code === 'requirement_missing');
});

test('discover importa novas, pula conhecidas e suprimidas, e não grava no dry-run', async () => {
  const { deps, queries } = setup();
  addCompany(deps, acme);
  suppressDomain(deps, 'gone.io', 'pediu para sair');

  const dry = await discoverCompanies(deps, { country: 'uk', dryRun: true });
  assert.deepEqual(dry.imported.map((item) => item.domain), ['beta.dev']);
  assert.equal(deps.store.companies.findByDomain('beta.dev'), null);

  const report = await discoverCompanies(deps, { country: 'uk' });
  assert.deepEqual(report.imported.map((item) => item.domain), ['beta.dev']);
  assert.deepEqual(report.alreadyKnown, ['acme.dev']);
  assert.deepEqual(report.suppressed, ['gone.io']);
  const beta = deps.store.companies.findByDomain('beta.dev')!;
  assert.equal(beta.status, 'identified');
  assert.equal(beta.country, 'GB');
  assert.match(beta.source!, /fake discover, 2026-10-26/);
  assert.equal(queries[1]?.country, 'GB');
  assert.ok(queries[1]?.keywords.includes('software development agency'));
});

test('discover por cidade grava a região e exige estado nos EUA', async () => {
  const { deps, queries } = setup({}, [{ domain: 'nyc.dev', name: 'NYC Dev' }]);
  await assert.rejects(discoverCompanies(deps, { country: 'US', city: 'New York' }), (error) => error instanceof DomainError && error.code === 'validation');
  await discoverCompanies(deps, { country: 'US', state: 'ny', city: 'New York', keywords: ['react agency'] });
  assert.deepEqual(queries.at(-1), { country: 'US', state: 'NY', city: 'New York', headcount: undefined, keywords: ['react agency'], limit: 20 });
  assert.equal(deps.store.companies.findByDomain('nyc.dev')?.region, 'New York, NY');
});

test('discover não cadastra empresa sem e-mail pessoal conhecido', async () => {
  const { deps } = setup({}, [
    { domain: 'empty.dev', name: 'Empty', personalEmails: 0 },
    { domain: 'full.dev', name: 'Full', personalEmails: 3 },
    { domain: 'unknown.dev', name: 'Unknown' },
  ]);
  const report = await discoverCompanies(deps, { country: 'GB' });
  assert.deepEqual(report.noContacts, ['empty.dev']);
  assert.deepEqual(report.imported.map((item) => item.domain), ['full.dev', 'unknown.dev']);
});

test('contacts cadastra decisor com a fonte e conta o crédito gasto', async () => {
  const { deps, searched } = setup({ 'beta.dev': [jane] });
  await discoverCompanies(deps, { country: 'GB' });
  const report = await findContacts(deps, ['beta.dev']);
  assert.equal(report.spentCredits, 1);
  assert.deepEqual(searched, ['beta.dev']);
  const [contact] = deps.store.contacts.listByCompany(deps.store.companies.findByDomain('beta.dev')!.id);
  assert.equal(contact?.email, 'jane@beta.dev');
  assert.equal(contact?.source, 'https://beta.dev/team');
  assert.equal(contact?.verificationStatus, 'verified');
});

test('contacts escolhe só cargos de decisão e põe dono antes de CTO', async () => {
  const dev: FoundContact = { ...jane, email: 'dev@beta.dev', name: 'Dev', role: 'Senior Frontend Developer' };
  const founder: FoundContact = { ...jane, email: 'ana@beta.dev', name: 'Ana', role: 'Founder' };
  const { deps } = setup({ 'beta.dev': [dev, jane, founder] });
  await discoverCompanies(deps, { country: 'GB' });
  const [entry] = (await findContacts(deps, ['beta.dev'], { perCompany: 2 })).companies;
  assert.deepEqual(entry?.added, ['Ana, Founder <ana@beta.dev>', 'Jane Doe, CTO <jane@beta.dev>']);
});

test('contacts explica quando nenhum cargo serve', async () => {
  const dev: FoundContact = { ...jane, role: 'Senior Frontend Developer' };
  const { deps } = setup({ 'beta.dev': [dev] });
  await discoverCompanies(deps, { country: 'GB' });
  const [entry] = (await findContacts(deps, ['beta.dev'])).companies;
  assert.match(entry?.note ?? '', /nenhum cargo de decisão/);
});

test('contacts não gasta crédito em empresa que já tem contato', async () => {
  const { deps, searched } = setup({ 'beta.dev': [jane] });
  await discoverCompanies(deps, { country: 'GB' });
  addContact(deps, 'beta.dev', { name: 'Ana', role: 'CEO', email: 'ana@beta.dev', source: 'https://beta.dev/team' });
  const report = await findContacts(deps, ['beta.dev']);
  assert.deepEqual(searched, []);
  assert.equal(report.spentCredits, 0);
});

test('contacts busca de novo quando o único contato foi apagado, sem recadastrar o e-mail bloqueado', async () => {
  const ana: FoundContact = { ...jane, email: 'ana@beta.dev', name: 'Ana', role: 'Founder' };
  const { deps, searched } = setup({ 'beta.dev': [jane, ana] });
  await discoverCompanies(deps, { country: 'GB' });
  await findContacts(deps, ['beta.dev'], { perCompany: 1 });
  erasePersonalData(deps, 'ana@beta.dev', 'teste');
  const [entry] = (await findContacts(deps, ['beta.dev'], { perCompany: 1 })).companies;
  assert.deepEqual(searched, ['beta.dev', 'beta.dev']);
  assert.deepEqual(entry?.added, ['Jane Doe, CTO <jane@beta.dev>']);
  assert.match(entry?.skipped[0] ?? '', /ana@beta\.dev: suprimido/);
});

test('contacts para no teto de créditos e continua da próxima vez', async () => {
  const { deps, searched } = setup({
    'beta.dev': [jane],
    'gone.io': [{ ...jane, email: 'ana@gone.io', name: 'Ana' }],
  });
  await discoverCompanies(deps, { country: 'GB', limit: 5 });
  const report = await findContacts(deps, ['beta.dev', 'gone.io'], { maxCredits: 1 });
  assert.equal(report.stoppedByCap, true);
  assert.deepEqual(searched, ['beta.dev']);
});

test('contacts descarta e-mail inválido, sem nome ou de outro domínio sem derrubar o lote', async () => {
  const { deps } = setup({
    'beta.dev': [
      { ...jane, email: 'bad@beta.dev', name: 'Bad', verification: 'invalid' },
      { ...jane, email: 'anon@beta.dev', name: '' },
      { ...jane, email: 'jane@other.com', name: 'Other' },
      jane,
    ],
  });
  await discoverCompanies(deps, { country: 'GB' });
  const [entry] = (await findContacts(deps, ['beta.dev'])).companies;
  assert.equal(entry?.added.length, 1);
  assert.equal(entry?.skipped.length, 3);
});

test('contacts recusa quando o saldo é zero', async () => {
  const { deps } = setup({}, undefined, 0);
  await assert.rejects(findContacts(deps, ['beta.dev']), (error) => error instanceof DomainError && error.code === 'requirement_missing');
});

test('run: só empresa qualificada pela IA gasta crédito', async () => {
  const { deps, searched } = setup({ 'beta.dev': [jane], 'gone.io': [{ ...jane, email: 'ana@gone.io', name: 'Ana' }] }, [
    { domain: 'beta.dev', name: 'Beta' },
    { domain: 'gone.io', name: 'Gone' },
  ]);
  deps.qualifying = {
    fetcher: { fetchSite: async (domain) => ({ pages: [{ url: `https://${domain}/`, text: 'We build custom software for clients.' }] }) },
    qualifier: {
      name: 'fake',
      qualify: async ({ company }) =>
        company.domain === 'beta.dev'
          ? { verdict: 'software_house', reason: 'ok', technologies: [], findings: [{ kind: 'business_model', stance: 'supports', claim: 'x', quote: 'We build custom software for clients', pageUrl: 'https://beta.dev/' }] }
          : { verdict: 'unclear', reason: 'pouco texto', technologies: [], findings: [] },
    },
  };
  const report = await runProspecting(deps, { country: 'GB' });
  assert.deepEqual(report.qualified.map((item) => `${item.domain}:${item.outcome}`), ['beta.dev:qualified', 'gone.io:unclear']);
  assert.deepEqual(searched, ['beta.dev']);
  assert.equal(report.contacts?.spentCredits, 1);
});
