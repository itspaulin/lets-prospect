import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FoundContact } from '../core/ports/prospecting.js';
import { createTestApi } from '../testing/api.js';
import { ProspectJobs } from './prospect-jobs.js';

const QUOTE = 'We build custom software for clients across the UK.';

// Fake Hunter and AI: beta.dev passes, gamma.dev's site cannot be read, every search costs one credit.
const setup = () => {
  const api = createTestApi();
  let balance = 10;
  let release: (() => void) | undefined;
  const searched: string[] = [];
  const jane: FoundContact = { email: 'jane@beta.dev', name: 'Jane Doe', role: 'CTO', verification: 'valid', sources: ['https://beta.dev/team'] };
  api.deps.prospecting = {
    leads: { name: 'fake', discover: async () => [{ domain: 'beta.dev', name: 'Beta' }, { domain: 'gamma.dev', name: 'Gamma' }] },
    finder: {
      name: 'fake',
      creditsRemaining: async () => balance,
      findDecisionMakers: async (domain) => (searched.push(domain), (balance -= 1), domain === 'beta.dev' ? [jane] : []),
    },
  };
  api.deps.qualifying = {
    fetcher: {
      fetchSite: async (domain) => {
        if (release) await new Promise<void>((resolve) => (release = resolve));
        return domain === 'gamma.dev' ? { pages: [], problem: 'bloqueado para robôs (HTTP 403)' } : { pages: [{ url: `https://${domain}/`, text: QUOTE }] };
      },
    },
    qualifier: {
      name: 'fake-ai',
      qualify: async ({ pages }) => ({
        verdict: 'software_house',
        reason: 'Agência de software.',
        technologies: [],
        findings: [{ kind: 'business_model', stance: 'supports', claim: 'Builds for clients', quote: QUOTE, pageUrl: pages[0]!.url }],
      }),
    },
  };
  // Holds every site fetch until the test lets go, so a run can be observed and stopped mid-way.
  const hold = () => (release = () => undefined);
  const letGo = () => release?.();
  return { ...api, searched, hold, letGo };
};

const finished = async (send: ReturnType<typeof setup>['send']) => {
  for (let attempt = 0; attempt < 200; attempt++) {
    const job = (await send('GET', '/api/prospect/job')).json();
    if (job.status !== 'running') return job;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('job did not finish');
};

test('status screen reports configuration, credits and defaults', async () => {
  const { send } = setup();
  const status = (await send('GET', '/api/prospect')).json();
  assert.deepEqual(status.hunter, { configured: true, credits: 10 });
  assert.equal(status.ai.model, 'fake-ai');
  assert.equal(status.pending, 0);
  assert.ok(status.defaults.keywords.includes('software house'));
});

test('preview imports nothing and needs the state for a US city', async () => {
  const { send, deps } = setup();
  const preview = await send('POST', '/api/prospect/preview', { country: 'GB' });
  assert.deepEqual(preview.json().imported.map((item: { domain: string }) => item.domain), ['beta.dev', 'gamma.dev']);
  assert.equal(deps.store.companies.all().length, 0);
  const noState = await send('POST', '/api/prospect/preview', { country: 'US', city: 'New York' });
  assert.equal(noState.statusCode, 400);
});

test('a search job runs the funnel: only the qualified company spends a credit', async () => {
  const { send, searched } = setup();
  const started = await send('POST', '/api/prospect/jobs', { mode: 'search', search: { country: 'GB' }, funnel: { maxCredits: 3 } });
  assert.equal(started.statusCode, 201);
  const job = await finished(send);
  assert.equal(job.status, 'done');
  assert.equal(job.label, 'GB');
  const [run] = (await send('GET', '/api/prospect')).json().runs;
  assert.deepEqual({ read: run.read, qualified: run.qualified, review: run.review, creditsSpent: run.creditsSpent, creditCap: run.creditCap, status: run.status }, { read: 2, qualified: 1, review: 1, creditsSpent: 1, creditCap: 3, status: 'done' });
  assert.deepEqual(job.qualified.map((item: { domain: string; outcome: string }) => `${item.domain}:${item.outcome}`), ['beta.dev:qualified', 'gamma.dev:unreachable']);
  assert.deepEqual(searched, ['beta.dev']);
  assert.equal(job.spentCredits, 1);
  assert.deepEqual(job.contacts[0].added, ['Jane Doe, CTO <jane@beta.dev>']);

  // The unreadable site lands in the review queue with its reason, and stays pending for a free retry.
  const status = (await send('GET', '/api/prospect')).json();
  assert.equal(status.review[0].company.domain, 'gamma.dev');
  assert.equal(status.review[0].kind, 'blocked');
  assert.equal(status.review[0].note, 'bloqueado para robôs (HTTP 403). Nada foi decidido.');
  assert.equal(status.pending, 1);
});

test('without contacts the run spends no credit', async () => {
  const { send, searched } = setup();
  await send('POST', '/api/prospect/jobs', { mode: 'search', search: { country: 'GB' }, funnel: { contacts: false } });
  const job = await finished(send);
  assert.equal(job.findsContacts, false);
  assert.deepEqual(searched, []);
});

test('one run at a time, and stop waits for the current company', async () => {
  const { send, hold, letGo, deps } = setup();
  hold();
  await send('POST', '/api/prospect/jobs', { mode: 'search', search: { country: 'GB' } });
  const second = await send('POST', '/api/prospect/jobs', { mode: 'pending' });
  assert.equal(second.statusCode, 400);
  await send('POST', '/api/prospect/job/stop');
  letGo();
  const job = await finished(send);
  assert.equal(job.status, 'stopped');
  assert.equal(job.qualified.length, 1);
  assert.equal(deps.store.companies.findByDomain('gamma.dev')?.status, 'identified');
});

test('per-company actions: qualify one company and look up its decision makers', async () => {
  const { send } = setup();
  await send('POST', '/api/companies', { name: 'Beta', website: 'beta.dev', country: 'GB' });
  const qualified = await send('POST', '/api/companies/beta.dev/ai-qualify');
  assert.equal(qualified.json().outcome, 'qualified');
  const contacts = await send('POST', '/api/companies/beta.dev/find-contacts', {});
  assert.equal(contacts.json().spentCredits, 1);
  assert.equal(contacts.json().companies[0].added.length, 1);
});

test('retry runs only the chosen companies, and a server restart closes a run left running', async () => {
  const { send, deps } = setup();
  await send('POST', '/api/prospect/jobs', { mode: 'search', search: { country: 'GB' }, funnel: { contacts: false } });
  await finished(send);
  await send('POST', '/api/prospect/jobs', { mode: 'retry', domains: ['gamma.dev', 'beta.dev'] });
  const retry = await finished(send);
  // beta.dev is already qualified, so only gamma.dev is read again.
  assert.deepEqual(retry.qualified.map((item: { domain: string }) => item.domain), ['gamma.dev']);
  assert.equal(retry.label, 'Tentar de novo: 2 empresas');

  deps.store.prospectRuns.insert({ id: 'stale', mode: 'pending', label: 'x', status: 'running', startedAt: '2026-10-26T00:00:00.000Z', read: 0, qualified: 0, review: 0, discarded: 0, creditsSpent: 0 });
  new ProspectJobs(deps);
  assert.equal(deps.store.prospectRuns.recent(10).find((run) => run.id === 'stale')?.status, 'failed');
});
