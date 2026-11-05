import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTestApi } from '../testing/api.js';
import { acme } from '../testing/deps.js';

const setup = createTestApi;

test('rejects writes without the client header and requests to other hosts', async () => {
  const { app } = setup();
  const noHeader = await app.inject({ method: 'POST', url: '/api/companies', payload: acme, headers: { host: '127.0.0.1:4317' } });
  assert.equal(noHeader.statusCode, 403);
  const rebinding = await app.inject({ method: 'GET', url: '/api/meta', headers: { host: 'evil.example:4317' } });
  assert.equal(rebinding.statusCode, 403);
});

test('creates a company, reports duplicates and maps domain errors to HTTP status', async () => {
  const { send } = setup();
  const created = await send('POST', '/api/companies', acme);
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().company.domain, 'acme.dev');

  const duplicate = await send('POST', '/api/companies', acme);
  assert.equal(duplicate.statusCode, 409);
  assert.match(duplicate.json().error, /já cadastrada/);

  const check = await send('GET', '/api/companies/check?website=https://app.acme.dev&name=Other');
  assert.equal(check.json().domain, 'app.acme.dev');
  assert.equal(check.json().similar[0].domain, 'acme.dev');

  const invalid = await send('GET', '/api/companies/check?website=not%20a%20site');
  assert.match(invalid.json().error, /Site inválido/);

  const missing = await send('GET', '/api/companies/nope.example');
  assert.equal(missing.statusCode, 404);
});

test('status changes follow the transition rules and need a verified business_model fact', async () => {
  const { send } = setup();
  await send('POST', '/api/companies', acme);

  const blocked = await send('POST', '/api/companies/acme.dev/status', { to: 'qualified' });
  assert.equal(blocked.statusCode, 422);

  const noReason = await send('POST', '/api/companies/acme.dev/status', { to: 'disqualified' });
  assert.equal(noReason.statusCode, 409);

  const evidence = await send('POST', '/api/companies/acme.dev/evidences', {
    kind: 'business_model',
    claim: 'Builds software for clients',
    certainty: 'verified',
    source: 'https://acme.dev/work',
  });
  assert.equal(evidence.statusCode, 201);

  const qualified = await send('POST', '/api/companies/acme.dev/status', { to: 'qualified' });
  assert.equal(qualified.statusCode, 200);
  assert.equal(qualified.json().status, 'qualified');

  const detail = (await send('GET', '/api/companies/acme.dev')).json();
  assert.equal(detail.company.status, 'qualified');
  assert.ok(detail.company.qualification.score > 0);
  assert.deepEqual(detail.allowedTransitions, ['contacted', 'identified', 'disqualified', 'inactive', 'do_not_contact']);
  assert.equal(detail.interactions[0].type, 'status_changed');
});

test('contacts expose decision maker, domain mismatch and block reason', async () => {
  const { send } = setup();
  await send('POST', '/api/companies', acme);
  const mismatch = await send('POST', '/api/companies/acme.dev/contacts', { name: 'Jane Doe', role: 'CTO', email: 'jane@gmail.com', source: 'https://acme.dev/team' });
  assert.equal(mismatch.statusCode, 400);

  const created = await send('POST', '/api/companies/acme.dev/contacts', {
    name: 'Jane Doe',
    role: 'CTO',
    email: 'jane@gmail.com',
    source: 'https://acme.dev/team',
    allowDomainMismatch: true,
  });
  assert.equal(created.statusCode, 201);

  const [contact] = (await send('GET', '/api/companies/acme.dev')).json().contacts;
  assert.equal(contact.decisionMaker, true);
  assert.equal(contact.domainMismatch, true);
  assert.equal(contact.blockReason, undefined);

  const blocked = await send('PATCH', '/api/contacts/jane@gmail.com', { doNotContact: true });
  assert.equal(blocked.json().doNotContact, true);
  const [after] = (await send('GET', '/api/companies/acme.dev')).json().contacts;
  assert.equal(after.blockReason, 'marcado para não contatar');
});

test('CSV import previews without writing, then imports', async () => {
  const { send } = setup();
  await send('POST', '/api/companies', acme);
  const csv = 'name,website,country,employees\nNew Co,newco.io,GB,12\nAcme,acme.dev,GB,20\nBad,bad,GB,x\n';

  const preview = (await send('POST', '/api/import/companies', { csv, dryRun: true })).json();
  assert.equal(preview.rows, 3);
  assert.equal(preview.created.length, 1);
  assert.equal(preview.skipped.length, 1);
  assert.equal(preview.failed.length, 1);
  assert.equal((await send('GET', '/api/companies')).json().length, 1);

  const real = (await send('POST', '/api/import/companies', { csv, dryRun: false })).json();
  assert.equal(real.created.length, 1);
  assert.equal((await send('GET', '/api/companies')).json().length, 2);
});

test('list filters and the today and meta views respond', async () => {
  const { send } = setup();
  await send('POST', '/api/companies', acme);
  await send('POST', '/api/companies', { ...acme, name: 'Beta', website: 'beta.io', country: 'US' });

  const gb = (await send('GET', '/api/companies?country=GB')).json();
  assert.deepEqual(gb.map((company: { domain: string }) => company.domain), ['acme.dev']);
  const badStatus = await send('GET', '/api/companies?status=nope');
  assert.equal(badStatus.statusCode, 400);

  await send('PUT', '/api/companies/beta.io/next-action', { at: '2026-10-26', note: 'Ligar' });
  const today = (await send('GET', '/api/today')).json();
  assert.equal(today.nextActions[0].domain, 'beta.io');
  assert.equal(today.sending.dailyLimit, 20);

  const meta = (await send('GET', '/api/meta')).json();
  assert.equal(meta.transport, 'outbox');
  assert.ok(meta.stack.includes('Node.js'));
  assert.deepEqual(meta.transitions.do_not_contact, []);
});
