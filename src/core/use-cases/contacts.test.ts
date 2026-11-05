import assert from 'node:assert/strict';
import test from 'node:test';
import { acme, createTestDeps } from '../../testing/deps.js';
import { DomainError } from '../errors.js';
import { addCompany, getCompanyHistory } from './companies.js';
import { addContact, listContacts, updateContact } from './contacts.js';
import { addEvidence } from './evidences.js';

const code = (expected: DomainError['code']) => (error: unknown) => error instanceof DomainError && error.code === expected;

const setup = () => {
  const context = createTestDeps();
  addCompany(context.deps, acme);
  addCompany(context.deps, { ...acme, name: 'Beta', website: 'beta.io' });
  return context;
};

test('associa vários contatos à empresa correta', () => {
  const { deps } = setup();
  const jane = addContact(deps, 'acme.dev', { name: 'Jane Doe', role: 'CTO', email: 'Jane@Acme.dev', source: 'https://acme.dev/team' });
  addContact(deps, 'acme.dev', { name: 'John Roe', role: 'Founder' });
  addContact(deps, 'beta.io', { name: 'Ana', role: 'CTO' });
  const acmeId = deps.store.companies.findByDomain('acme.dev')!.id;
  assert.equal(jane.companyId, acmeId);
  assert.equal(jane.email, 'jane@acme.dev');
  assert.deepEqual(listContacts(deps, 'acme.dev').map((contact) => contact.name), ['Jane Doe', 'John Roe']);
  const added = getCompanyHistory(deps, 'acme.dev').interactions.find((interaction) => interaction.type === 'contact_added')!;
  assert.equal(added.contactId, jane.id);
});

test('e-mail de outro domínio indica empresa errada', () => {
  const { deps } = setup();
  assert.throws(() => addContact(deps, 'acme.dev', { name: 'Ana', email: 'ana@beta.io', source: 'site' }), /não é do domínio acme\.dev/);
  const gmail = addContact(deps, 'acme.dev', { name: 'Ana', email: 'ana@gmail.com', source: 'site' }, { allowDomainMismatch: true });
  assert.equal(gmail.email, 'ana@gmail.com');
  addContact(deps, 'acme.dev', { name: 'Leo', email: 'leo@uk.acme.dev', source: 'site' });
});

test('impede contatos duplicados por e-mail e por nome na empresa', () => {
  const { deps } = setup();
  addContact(deps, 'acme.dev', { name: 'Jane Doe', email: 'jane@acme.dev', source: 'site' });
  assert.throws(() => addContact(deps, 'acme.dev', { name: 'J. Doe', email: 'JANE@acme.dev', source: 'site' }), code('duplicate'));
  assert.throws(() => addContact(deps, 'acme.dev', { name: 'jane doe' }), code('duplicate'));
  addContact(deps, 'beta.io', { name: 'Jane Doe' });
});

test('e-mail exige fonte de onde foi obtido', () => {
  const { deps } = setup();
  assert.throws(() => addContact(deps, 'acme.dev', { name: 'Jane', email: 'jane@acme.dev' }), /--source/);
  assert.throws(() => addEvidence(deps, 'acme.dev', { kind: 'business_model', claim: 'agência', certainty: 'verified' }), /--source/);
});

test('do_not_contact de contato só sai com motivo e fica no histórico', () => {
  const { deps } = setup();
  const jane = addContact(deps, 'acme.dev', { name: 'Jane', email: 'jane@acme.dev', source: 'site' });
  assert.equal(updateContact(deps, 'jane@acme.dev', { doNotContact: true }).doNotContact, true);
  assert.throws(() => updateContact(deps, jane.id, { doNotContact: false }), /--reason/);
  updateContact(deps, jane.id, { doNotContact: false }, { reason: 'marcado no contato errado' });
  const updates = getCompanyHistory(deps, 'acme.dev').interactions.filter((interaction) => interaction.type === 'contact_updated');
  assert.equal(updates.length, 2);
  assert.match(updates[1]!.summary, /marcado no contato errado/);
});

test('remover a fonte de contato com e-mail é bloqueado', () => {
  const { deps } = setup();
  addContact(deps, 'acme.dev', { name: 'Jane', email: 'jane@acme.dev', source: 'site' });
  assert.throws(() => updateContact(deps, 'jane@acme.dev', { source: null }), /fonte/);
});
