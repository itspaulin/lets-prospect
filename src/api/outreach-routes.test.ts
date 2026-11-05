import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createTestApi } from '../testing/api.js';
import { acme } from '../testing/deps.js';
import { FIRST_TEMPLATE, FOLLOW_UP_TEMPLATE } from '../testing/outreach.js';

type Api = ReturnType<typeof createTestApi>;

const qualify = async ({ send }: Api, overrides: Record<string, unknown> = {}, email = 'jane@acme.dev') => {
  const company = { ...acme, ...overrides };
  const created = (await send('POST', '/api/companies', company)).json().company;
  const evidence = (
    await send('POST', `/api/companies/${created.domain}/evidences`, { kind: 'business_model', claim: 'Builds for clients', certainty: 'verified', source: `https://${created.domain}/work` })
  ).json();
  await send('POST', `/api/companies/${created.domain}/contacts`, { name: 'Jane Doe', role: 'CTO', email, source: `https://${created.domain}/team` });
  assert.equal((await send('POST', `/api/companies/${created.domain}/status`, { to: 'qualified' })).statusCode, 200);
  return { domain: created.domain as string, evidenceId: evidence.id as string };
};

const activeCampaign = async (api: Api) => {
  const { send } = api;
  assert.equal((await send('POST', '/api/campaigns', { name: 'uk', market: 'GB' })).statusCode, 201);
  assert.equal((await send('PUT', '/api/campaigns/uk/templates/0', FIRST_TEMPLATE)).statusCode, 200);
  assert.equal((await send('PUT', '/api/campaigns/uk/templates/1', FOLLOW_UP_TEMPLATE)).statusCode, 200);

  const early = await send('POST', '/api/campaigns/uk/activate');
  assert.equal(early.statusCode, 422);

  await send('POST', '/api/campaigns/uk/templates/0/approve');
  await send('POST', '/api/campaigns/uk/templates/1/approve');
  assert.equal((await send('POST', '/api/campaigns/uk/activate')).json().status, 'active');
};

const waitForJob = async ({ send }: Api) => {
  for (let tries = 0; tries < 50; tries++) {
    const job = (await send('GET', '/api/send-job')).json();
    if (job && job.status !== 'running') return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('send job did not finish');
};

test('campaign lifecycle: templates, preview, selection, personalization, review and send', async () => {
  const api = createTestApi();
  const { send } = api;
  const { domain, evidenceId } = await qualify(api);
  await activeCampaign(api);

  const preview = (await send('POST', '/api/campaigns/uk/preview', { step: 0, companyRef: domain, reason: 'I read your case study.' })).json();
  assert.equal(preview.personalization, 'evidence_based');
  assert.match(preview.body, /I read your case study/);
  const badPlaceholder = await send('POST', '/api/campaigns/uk/preview', { step: 0, subject: 'Hi {{nope}}', body: 'x' });
  assert.equal(badPlaceholder.statusCode, 400);

  const detail = (await send('GET', '/api/campaigns/uk')).json();
  assert.equal(detail.candidates.length, 1);
  assert.equal(detail.templates[0].versions[0].approvedAt !== undefined, true);

  const selected = (await send('POST', '/api/campaigns/uk/select', { countries: ['GB'] })).json();
  assert.equal(selected.added.length, 1);

  const generic = (await send('POST', '/api/campaigns/uk/draft-all')).json();
  assert.equal(generic.drafted, 1);

  const hypothesis = (await send('POST', `/api/companies/${domain}/evidences`, { kind: 'demand_signal', claim: 'maybe hiring', certainty: 'hypothesis' })).json();
  const rejected = await send('POST', '/api/campaigns/uk/drafts', { company: domain, reason: 'Saw you are hiring', evidenceIds: [hypothesis.id] });
  assert.equal(rejected.statusCode, 400);

  const personal = (await send('POST', '/api/campaigns/uk/drafts', { company: domain, reason: 'I read your case study.', evidenceIds: [evidenceId] })).json();
  assert.equal(personal.personalization, 'evidence_based');

  const queue = (await send('GET', '/api/review?campaign=uk')).json();
  assert.equal(queue.length, 1);
  assert.equal(queue[0].evidences[0].id, evidenceId);

  const edited = (await send('PUT', `/api/messages/${personal.id}`, { subject: personal.subject, body: `${personal.body}\n` })).json();
  assert.equal(edited.status, 'draft');
  assert.equal((await send('POST', `/api/messages/${personal.id}/approve`)).json().status, 'approved');

  const dry = (await send('POST', '/api/campaigns/uk/send', { dryRun: true })).json();
  assert.deepEqual(
    dry.outcomes.map((item: { outcome: string }) => item.outcome),
    ['would_send'],
  );

  const job = (await send('POST', '/api/campaigns/uk/send', { dryRun: false })).json();
  assert.equal(job.total, 1);
  const finished = await waitForJob(api);
  assert.equal(finished.status, 'done');
  assert.equal(finished.outcomes[0].outcome, 'sent');
  assert.equal(api.email.sent.length, 1);

  const again = await send('POST', '/api/campaigns/uk/send', { dryRun: false });
  assert.equal(again.statusCode, 400);
  assert.equal((await send('GET', `/api/companies/${domain}`)).json().company.status, 'contacted');
});

test('real transport requires typing ENVIAR', async () => {
  const api = createTestApi();
  Object.defineProperty(api.email, 'delivers', { value: true });
  const { send } = api;
  await qualify(api);
  await activeCampaign(api);
  await send('POST', '/api/campaigns/uk/select', {});
  await send('POST', '/api/campaigns/uk/draft-all');
  const [message] = (await send('GET', '/api/review')).json();
  await send('POST', `/api/messages/${message.id}/approve`);

  assert.equal((await send('POST', '/api/campaigns/uk/send', { dryRun: false })).statusCode, 400);
  assert.equal((await send('POST', '/api/campaigns/uk/send', { dryRun: false, confirm: 'enviar' })).statusCode, 400);
  assert.equal((await send('POST', '/api/campaigns/uk/send', { dryRun: false, confirm: 'ENVIAR' })).statusCode, 200);
  assert.equal((await waitForJob(api)).status, 'done');
  assert.equal((await send('POST', '/api/settings/test-email', {})).statusCode, 400);
});

test('failed and unknown sends show up for conciliation and can be resolved', async () => {
  const api = createTestApi();
  const { send, email } = api;
  await qualify(api);
  await qualify(api, { name: 'Beta', website: 'beta.io' }, 'jane@beta.io');
  await activeCampaign(api);
  await send('POST', '/api/campaigns/uk/select', {});
  await send('POST', '/api/campaigns/uk/draft-all');
  for (const message of (await send('GET', '/api/review')).json()) await send('POST', `/api/messages/${message.id}/approve`);

  let call = 0;
  email.next = () => (++call === 1 ? { status: 'failed', error: '421 Try again later' } : { status: 'unknown', error: 'timeout após DATA' });
  await send('POST', '/api/campaigns/uk/send', { dryRun: false });
  await waitForJob(api);

  const board = (await send('GET', '/api/conciliation')).json();
  assert.equal(board.failed.length, 1);
  assert.equal(board.unknown.length, 1);
  assert.equal(board.unknown[0].attempts.length, 1);
  assert.equal((await send('GET', '/api/meta')).json().badges.conciliation, 2);

  assert.equal((await send('POST', `/api/messages/${board.failed[0].id}/retry`)).json().status, 'approved');
  assert.equal((await send('POST', `/api/messages/${board.unknown[0].id}/resolve`, { sent: true, note: 'Está em Enviados' })).json().status, 'sent');
});

test('replies show their effect, unsubscribe suppresses and follow-ups list why they are blocked', async () => {
  const api = createTestApi();
  const { send } = api;
  await qualify(api);
  await activeCampaign(api);
  await send('POST', '/api/campaigns/uk/select', {});
  await send('POST', '/api/campaigns/uk/draft-all');
  const [message] = (await send('GET', '/api/review')).json();
  await send('POST', `/api/messages/${message.id}/approve`);
  await send('POST', '/api/campaigns/uk/send', { dryRun: false });
  await waitForJob(api);

  api.advanceDays(10);
  const due = (await send('GET', '/api/followups')).json();
  assert.equal(due[0].state, 'due');
  assert.equal(due[0].hasTemplate, true);

  const contacts = (await send('GET', '/api/replies/contacts')).json();
  assert.equal(contacts[0].email, 'jane@acme.dev');

  const recorded = await send('POST', '/api/replies', { contact: 'jane@acme.dev', category: 'unsubscribe', summary: 'Please remove me' });
  assert.equal(recorded.statusCode, 201);
  const [reply] = (await send('GET', '/api/replies')).json();
  assert.equal(reply.effect.suppressContact, true);
  assert.equal(reply.campaign, 'uk');

  const blocked = (await send('GET', '/api/followups')).json();
  assert.equal(blocked[0].state, 'blocked');

  const suppressions = (await send('GET', '/api/suppressions')).json();
  assert.equal(suppressions[0].contact.email, 'jane@acme.dev');
  assert.equal((await send('GET', '/api/suppressions/check?value=JANE@acme.dev')).json().suppressed, true);
  assert.equal((await send('GET', '/api/suppressions/check?value=other.io')).json().suppressed, false);

  const domain = await send('POST', '/api/suppressions', { kind: 'domain', value: 'https://spam.example', reason: 'pediu' });
  assert.equal(domain.statusCode, 201);
  assert.equal((await send('POST', '/api/suppressions', { kind: 'domain', value: 'spam.example', reason: 'de novo' })).json().inserted, false);

  const report = (await send('GET', '/api/report?campaign=uk')).json();
  assert.equal(report.rates[0].denominator, 1);
  assert.equal((await send('GET', `/api/companies/acme.dev`)).json().company.status, 'do_not_contact');
});

test('settings save validated config files and apply them right away', async () => {
  const api = createTestApi();
  const { send, sendingPath, scoringPath } = api;
  const settings = (await send('GET', '/api/settings')).json();
  assert.equal(settings.transport, 'outbox');
  assert.match(settings.footerPreview, /PO Box 1/);

  const invalid = await send('PUT', '/api/settings/sending', { ...settings.sending, dailyLimit: 0 });
  assert.equal(invalid.statusCode, 400);

  const saved = (await send('PUT', '/api/settings/sending', { ...settings.sending, dailyLimit: 12 })).json();
  assert.equal(saved.version, settings.sending.version + 1);
  assert.equal(JSON.parse(readFileSync(sendingPath, 'utf8')).dailyLimit, 12);
  assert.equal((await send('GET', '/api/meta')).json().sending.dailyLimit, 12);

  const criteria = settings.scoring.criteria.map((criterion: { id: string; weight: number }) => (criterion.id === 'size' ? { ...criterion, weight: 20 } : criterion));
  const scoring = (await send('PUT', '/api/settings/scoring', { ...settings.scoring, criteria })).json();
  assert.equal(scoring.version, settings.scoring.version + 1);
  assert.equal(JSON.parse(readFileSync(scoringPath, 'utf8')).criteria.find((criterion: { id: string }) => criterion.id === 'size').weight, 20);

  // "Minha stack" saves through the same endpoint and changes what the screens highlight.
  const stack = scoring.criteria.map((criterion: { id: string }) => (criterion.id === 'stack' ? { ...criterion, technologies: ['Go', 'Rust'], minKnown: 2 } : criterion));
  await send('PUT', '/api/settings/scoring', { ...scoring, criteria: stack });
  assert.deepEqual((await send('GET', '/api/meta')).json().stack, ['Go', 'Rust']);
  assert.equal(JSON.parse(readFileSync(scoringPath, 'utf8')).criteria.find((criterion: { id: string }) => criterion.id === 'stack').minKnown, 2);

  const deliverability = (await send('GET', '/api/settings/deliverability')).json();
  assert.equal(deliverability.domain, 'example.dev');
});
