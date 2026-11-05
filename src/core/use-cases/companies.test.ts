import assert from 'node:assert/strict';
import test from 'node:test';
import { acme, createTestDeps } from '../../testing/deps.js';
import { DomainError } from '../errors.js';
import {
  addCompany,
  addCompanyNote,
  changeCompanyStatus,
  findDuplicateCandidates,
  getCompanyHistory,
  listCompanies,
  setNextAction,
  updateCompany,
} from './companies.js';
import { addContact } from './contacts.js';
import { addEvidence } from './evidences.js';

const code = (expected: DomainError['code']) => (error: unknown) => error instanceof DomainError && error.code === expected;

test('cadastra empresa válida com dados normalizados e histórico', () => {
  const { deps } = createTestDeps();
  const { company } = addCompany(deps, acme);
  assert.equal(company.domain, 'acme.dev');
  assert.equal(company.country, 'GB');
  assert.equal(company.status, 'identified');
  assert.equal(company.source, 'https://www.acme.dev/about');
  const json = (value: unknown) => JSON.parse(JSON.stringify(value));
  assert.deepEqual(json(deps.store.companies.findByDomain('acme.dev')), json(company));
  const [created] = getCompanyHistory(deps, 'acme.dev').interactions;
  assert.equal(created?.type, 'company_created');
  assert.match(created!.summary, /fonte: https:\/\/www\.acme\.dev\/about/);
});

test('rejeita cadastro inválido sem gravar nada', () => {
  const { deps } = createTestDeps();
  assert.throws(() => addCompany(deps, { ...acme, name: ' ' }), code('validation'));
  assert.throws(() => addCompany(deps, { ...acme, country: 'Inglaterra' }), code('validation'));
  assert.throws(() => addCompany(deps, { ...acme, employeeCount: -3 }), code('validation'));
  assert.equal(deps.store.companies.all().length, 0);
});

test('impede duplicidade pelo domínio normalizado', () => {
  const { deps } = createTestDeps();
  addCompany(deps, acme);
  assert.throws(() => addCompany(deps, { ...acme, name: 'Outra', website: 'http://ACME.dev' }), code('duplicate'));
  assert.equal(deps.store.companies.all().length, 1);
});

test('avisa sobre empresa parecida com outro domínio', () => {
  const { deps } = createTestDeps();
  addCompany(deps, acme);
  const { similar } = addCompany(deps, { ...acme, name: 'ACME Software LLC', website: 'acme.io' });
  assert.deepEqual(similar.map((company) => company.domain), ['acme.dev']);
  addCompany(deps, { ...acme, name: 'Acme Labs', website: 'labs.acme.dev' });
  assert.equal(findDuplicateCandidates(deps)[0]?.length, 3);
});

test('atualiza empresa, registra só o que mudou e permite apagar campo', () => {
  const { deps, advanceDays } = createTestDeps();
  addCompany(deps, { ...acme, region: 'London' });
  advanceDays(1);
  const updated = updateCompany(deps, 'acme.dev', { employeeCount: 30, region: null, name: acme.name });
  assert.equal(updated.employeeCount, 30);
  assert.equal(updated.region, undefined);
  assert.equal(updated.updatedAt, '2026-10-27T12:00:00.000Z');
  const last = getCompanyHistory(deps, 'acme.dev').interactions.at(-1)!;
  assert.equal(last.type, 'company_updated');
  assert.deepEqual(Object.keys(last.data!), ['region', 'employeeCount']);
  assert.equal(updateCompany(deps, 'acme.dev', { employeeCount: 30 }).updatedAt, updated.updatedAt);
});

test('mudar o site para domínio de outra empresa é bloqueado', () => {
  const { deps } = createTestDeps();
  addCompany(deps, acme);
  addCompany(deps, { ...acme, name: 'Beta', website: 'beta.dev' });
  assert.throws(() => updateCompany(deps, 'beta.dev', { website: 'acme.dev' }), code('duplicate'));
});

test('não qualifica empresa sem fato verificado de modelo de negócio', () => {
  const { deps } = createTestDeps();
  addCompany(deps, acme);
  addEvidence(deps, 'acme.dev', { kind: 'business_model', claim: 'parece agência', certainty: 'hypothesis' });
  assert.throws(() => changeCompanyStatus(deps, 'acme.dev', 'qualified'), code('requirement_missing'));
  assert.equal(deps.store.companies.findByDomain('acme.dev')!.status, 'identified');

  addEvidence(deps, 'acme.dev', { kind: 'business_model', claim: 'site lista clientes atendidos', certainty: 'verified', source: 'https://acme.dev/work' });
  const qualified = changeCompanyStatus(deps, 'acme.dev', 'qualified');
  assert.equal(qualified.status, 'qualified');
  assert.equal(qualified.qualification?.missingRequired.length, 0);
});

test('mudanças de status ficam consistentes com o histórico', () => {
  const { deps } = createTestDeps();
  addCompany(deps, acme);
  changeCompanyStatus(deps, 'acme.dev', 'disqualified', { reason: 'só produto próprio' });
  assert.equal(deps.store.companies.findByDomain('acme.dev')!.disqualificationReason, 'só produto próprio');
  changeCompanyStatus(deps, 'acme.dev', 'identified', { reason: 'reavaliar' });
  assert.equal(deps.store.companies.findByDomain('acme.dev')!.disqualificationReason, undefined);
  changeCompanyStatus(deps, 'acme.dev', 'do_not_contact', { reason: 'pediu para não receber' });

  const history = getCompanyHistory(deps, 'acme.dev');
  const changes = history.interactions.filter((interaction) => interaction.type === 'status_changed').map((interaction) => interaction.data);
  assert.deepEqual(changes.map((data) => [data!.from, data!.to]), [['identified', 'disqualified'], ['disqualified', 'identified'], ['identified', 'do_not_contact']]);
  assert.equal(changes.at(-1)!.to, history.company.status);
});

test('transição inválida não grava status nem histórico', () => {
  const { deps } = createTestDeps();
  addCompany(deps, acme);
  assert.throws(() => changeCompanyStatus(deps, 'acme.dev', 'contacted'), code('invalid_transition'));
  assert.equal(getCompanyHistory(deps, 'acme.dev').interactions.length, 1);
});

test('próxima ação e nota entram no histórico', () => {
  const { deps } = createTestDeps();
  addCompany(deps, acme);
  setNextAction(deps, 'acme.dev', { at: '2026-11-03', note: 'buscar CTO' });
  addCompanyNote(deps, 'acme.dev', 'Vi palestra do CTO sobre NestJS');
  assert.throws(() => setNextAction(deps, 'acme.dev', { at: '03/11/2026' }), code('validation'));
  const types = getCompanyHistory(deps, 'acme.dev').interactions.map((interaction) => interaction.type);
  assert.deepEqual(types, ['company_created', 'next_action_set', 'note_added']);
  assert.equal(setNextAction(deps, 'acme.dev', { at: null }).nextActionAt, undefined);
});

test('lista com filtros da base comercial', () => {
  const { deps, advanceDays } = createTestDeps();
  addCompany(deps, acme);
  addCompany(deps, { ...acme, name: 'Beta', website: 'beta.io', country: 'US', employeeCount: 120, technologies: ['PHP'], priority: 'high' });
  addCompany(deps, { name: 'Gamma', website: 'gamma.ca', country: 'CA' });
  addContact(deps, 'acme.dev', { name: 'Jane', role: 'CTO' });
  setNextAction(deps, 'gamma.ca', { at: '2026-10-30' });
  changeCompanyStatus(deps, 'beta.io', 'disqualified', { reason: 'Tamanho acima do ICP' });
  advanceDays(10);
  addCompanyNote(deps, 'gamma.ca', 'retomar');

  const domains = (filter: Parameters<typeof listCompanies>[1]) => listCompanies(deps, filter).map((company) => company.domain).sort();
  assert.deepEqual(domains({ countries: ['uk', 'CA'] }), ['acme.dev', 'gamma.ca']);
  assert.deepEqual(domains({ technology: 'react' }), ['acme.dev']);
  assert.deepEqual(domains({ minEmployees: 5, maxEmployees: 50 }), ['acme.dev']);
  assert.deepEqual(domains({ hasContacts: true }), ['acme.dev']);
  assert.deepEqual(domains({ hasContacts: false }), ['beta.io', 'gamma.ca']);
  assert.deepEqual(domains({ statuses: ['disqualified'] }), ['beta.io']);
  assert.deepEqual(domains({ disqualificationReason: 'tamanho' }), ['beta.io']);
  assert.deepEqual(domains({ priority: 'high' }), ['beta.io']);
  assert.deepEqual(domains({ nextActionDueBy: '2026-10-31' }), ['gamma.ca']);
  assert.deepEqual(domains({ lastInteractionBefore: '2026-11-01' }), ['acme.dev', 'beta.io']);
  assert.deepEqual(domains({ lastInteractionAfter: '2026-11-01' }), ['gamma.ca']);
  assert.equal(listCompanies(deps)[0]?.domain, 'beta.io');
});
