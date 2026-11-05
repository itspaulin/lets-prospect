import assert from 'node:assert/strict';
import test from 'node:test';
import type { Lead } from '../core/entities/lead.js';
import type { Place } from '../core/ports/places.js';
import { createTestApi } from '../testing/api.js';

type Api = ReturnType<typeof createTestApi>;

const SENTENCE = 'Somos uma imobiliária com mais de vinte anos vendendo e alugando imóveis na região.';

const lead = (n: number, extra: Partial<Lead> = {}): Lead => ({
  id: `lead-${n}`,
  placeId: `place-${n}`,
  name: `Imob ${n} - Imobiliária BH`,
  phone: `+55313333${4000 + n}`,
  phoneKind: 'landline',
  whatsapp: `+553199999${1000 + n}`,
  whatsappSource: `https://imob${n}.com.br/`,
  website: `https://imob${n}.com.br`,
  enrichedAt: '2026-10-26T10:00:00.000Z',
  qualification: { verdict: 'fit', reason: 'é uma imobiliária', signals: [], model: 'fake' },
  qualifiedAt: '2026-10-26T10:00:00.000Z',
  segment: 'imobiliária',
  status: 'identified',
  source: 'test',
  createdAt: `2026-10-26T10:0${n}:00.000Z`,
  updatedAt: '2026-10-26T10:00:00.000Z',
  ...extra,
});

const seed = (api: Api, count = 3, extra: (n: number) => Partial<Lead> = () => ({})) => {
  for (let n = 1; n <= count; n++) api.deps.store.leads.insert(lead(n, extra(n)));
};

const waitForJob = async ({ send }: Api) => {
  for (let tries = 0; tries < 100; tries++) {
    const job = (await send('GET', '/api/job')).json();
    if (job && job.status !== 'running') return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('a tarefa não terminou');
};

test('lista de leads traz o veredito de cada um, o resumo e a cota do Google', async () => {
  const api = createTestApi();
  seed(api, 4, (n) =>
    n === 2
      ? { qualification: { verdict: 'unclear', reason: 'site não lido: erro de rede', signals: [], model: 'fake' }, qualifiedAt: undefined }
      : n === 3
        ? { qualification: undefined, qualifiedAt: undefined, whatsapp: undefined, enrichedAt: undefined }
        : n === 4
          ? { qualification: { verdict: 'not_a_fit', reason: 'é um portal', signals: [], model: 'fake' } }
          : {},
  );
  api.deps.store.leadSearches.insert({ id: 's1', query: 'imobiliária em Natal, RN', ranAt: '2026-10-20T10:00:00.000Z', found: 60, imported: 40, requests: 3 });
  const response = await api.send('GET', '/api/leads');
  assert.equal(response.statusCode, 200);
  const view = response.json();
  assert.deepEqual(view.leads.map((row: { verdict: string }) => row.verdict), ['fit', 'unreadable', 'pending', 'not_a_fit']);
  api.deps.store.leads.update({ ...api.deps.store.leads.findById('lead-3')!, enrichedAt: '2026-10-26T10:00:00.000Z' });
  assert.equal((await api.send('GET', '/api/leads')).json().leads[2].verdict, 'no_whatsapp');
  assert.deepEqual(view.summary, { total: 4, fit: 1, unclear: 1, notFit: 1, pending: 1, withWhatsapp: 3, noWhatsapp: 0, notRead: 1, contacted: 0 });
  assert.equal(view.discovery.requestsThisMonth, 3);
  assert.equal(view.discovery.maxRequestsPerMonth, 100);
  assert.equal(view.discovery.targets[0].city, 'Belo Horizonte');
  assert.equal(view.discovery.places, false);
  assert.equal(view.discovery.ai, false);
});

test('buscar um lugar à mão: simulação não grava, a busca grava e some das próximas', async () => {
  const api = createTestApi();
  const found: Place[] = [{ placeId: 'a', name: 'Imob A', phone: '+55 31 99999-8888', website: 'https://a.com.br' }];
  api.deps.places = { name: 'fake', search: async () => found };
  const dry = await api.send('POST', '/api/leads/discover', { city: 'Betim', state: 'MG', dryRun: true });
  assert.equal(dry.json().imported.length, 1);
  assert.equal((await api.send('GET', '/api/leads')).json().leads.length, 0);
  assert.equal((await api.send('POST', '/api/leads/discover', { city: 'Betim', state: 'MG', area: 'Centro' })).json().imported.length, 1);
  assert.equal((await api.send('GET', '/api/leads')).json().leads.length, 1);
  assert.equal((await api.send('POST', '/api/leads/discover', { city: '' })).statusCode, 400);
  const noKey = createTestApi();
  assert.equal((await noKey.send('POST', '/api/leads/discover', { city: 'Betim' })).statusCode, 422);
});

test('tarefas de leads: ler sites e IA rodam em segundo plano e deixam linhas e resumo', async () => {
  const api = createTestApi();
  seed(api, 2, () => ({ whatsapp: undefined, enrichedAt: undefined, qualification: undefined, qualifiedAt: undefined }));
  api.deps.pages = { fetchRaw: async (domain: string) => ({ pages: [{ url: `https://${domain}/`, html: '<a href="https://wa.me/5531988880000">x</a>' }] }) };
  const enrich = await api.send('POST', '/api/jobs', { kind: 'leads.enrich' });
  assert.equal(enrich.statusCode, 201);
  const enriched = await waitForJob(api);
  assert.equal(enriched.status, 'done');
  assert.equal(enriched.lines.length, 2);
  assert.match(enriched.summary[0], /WhatsApp achado no site: 2/);

  api.deps.qualifying = { fetcher: { fetchSite: async (domain: string) => ({ pages: [{ url: `https://${domain}/`, text: SENTENCE }] }) }, qualifier: undefined as never };
  api.deps.leadQualifier = { name: 'fake ai', qualify: async (input) => ({ verdict: 'fit', reason: 'é imobiliária', signals: [{ kind: 'activity', claim: 'vende', quote: SENTENCE, pageUrl: `https://${input.pages[0]!.url.split('/')[2]}/` }] }) };
  assert.equal((await api.send('POST', '/api/jobs', { kind: 'leads.qualify' })).statusCode, 201);
  const qualified = await waitForJob(api);
  assert.equal(qualified.status, 'done');
  assert.match(qualified.summary[0], /Bons: 2/);
  assert.equal((await api.send('GET', '/api/leads')).json().summary.fit, 2);
});

test('uma tarefa por vez, e erro da tarefa aparece sem derrubar o servidor', async () => {
  const api = createTestApi();
  api.deps.places = { name: 'fake', search: () => new Promise(() => undefined) };
  api.deps.leadsConfig = { ...api.deps.leadsConfig, discovery: { ...api.deps.leadsConfig.discovery, minCandidates: 5 } };
  assert.equal((await api.send('POST', '/api/jobs', { kind: 'leads.auto' })).statusCode, 201);
  const second = await api.send('POST', '/api/jobs', { kind: 'leads.enrich' });
  assert.equal(second.statusCode, 400);
  assert.match(second.json().error, /já existe uma tarefa/i);
  const stopped = await api.send('POST', '/api/job/stop');
  assert.equal(stopped.json().stopRequested, true);

  const failing = createTestApi();
  assert.equal((await failing.send('POST', '/api/jobs', { kind: 'leads.qualify' })).statusCode, 201);
  const job = await waitForJob(failing);
  assert.equal(job.status, 'failed');
  assert.match(job.error, /AWS_BEARER_TOKEN_BEDROCK/);
});

test('fila: preparar, aprovar, editar, cancelar e simular o envio', async () => {
  const api = createTestApi();
  seed(api, 3);
  const before = (await api.send('GET', '/api/whatsapp')).json();
  assert.equal(before.ready, 3);
  assert.equal(before.channel.delivers, false);
  assert.equal(before.today.inWindow, true);
  assert.equal(before.today.remaining, 5);

  const drafted = (await api.send('POST', '/api/whatsapp/draft')).json();
  assert.equal(drafted.drafted, 3);
  const view = (await api.send('GET', '/api/whatsapp')).json();
  assert.equal(view.counts.draft, 3);
  assert.equal(view.ready, 0);
  const [first, second] = view.messages.map((message: { id: string }) => message.id);

  assert.equal((await api.send('POST', '/api/whatsapp/approve', {})).statusCode, 400);
  assert.equal((await api.send('POST', '/api/whatsapp/approve', { ids: [first] })).json().approved, 1);
  assert.equal((await api.send('PUT', `/api/whatsapp/messages/${first}`, { body: 'Oi, tudo bem?' })).json().status, 'draft');
  assert.equal((await api.send('PUT', `/api/whatsapp/messages/${first}`, { body: '  ' })).statusCode, 400);
  assert.equal((await api.send('POST', '/api/whatsapp/approve', { all: true })).json().approved, 3);
  assert.equal((await api.send('POST', `/api/whatsapp/messages/${second}/cancel`, { reason: '' })).statusCode, 400);
  assert.equal((await api.send('POST', `/api/whatsapp/messages/${second}/cancel`, { reason: 'não quero' })).json().status, 'cancelled');

  const dry = (await api.send('POST', '/api/whatsapp/dry-run')).json();
  assert.deepEqual(dry.outcomes.map((item: { outcome: string }) => item.outcome), ['would_send', 'would_send']);
  assert.equal((await api.send('GET', '/api/whatsapp')).json().counts.approved, 2);
  assert.equal(api.whatsappChannel.sent.length, 0);
});

test('rotina completa: roda em segundo plano, envia e conta o limite do dia', async () => {
  const api = createTestApi();
  seed(api, 2);
  api.deps.whatsapp = { ...api.deps.whatsapp, autoApprove: true };
  api.deps.leadsConfig = { ...api.deps.leadsConfig, discovery: { ...api.deps.leadsConfig.discovery, minCandidates: 0 } };
  api.deps.qualifying = { fetcher: { fetchSite: async () => ({ pages: [] }) }, qualifier: undefined as never };
  api.deps.leadQualifier = { name: 'fake', qualify: async () => ({ verdict: 'unclear', reason: 'x', signals: [] }) };
  assert.equal((await api.send('POST', '/api/jobs', { kind: 'wa.run' })).statusCode, 201);
  const job = await waitForJob(api);
  assert.equal(job.status, 'done');
  assert.equal(job.lines.filter((line: { tone: string }) => line.tone === 'gn').length, 2);
  assert.match(job.summary.join(' '), /Enviadas agora: 2/);
  const view = (await api.send('GET', '/api/whatsapp')).json();
  assert.equal(view.counts.sent, 2);
  assert.equal(view.today.remaining, 3);
});

test('envio que entrega de verdade exige digitar ENVIAR, checado no servidor', async () => {
  const api = createTestApi();
  (api.deps.whatsappChannel as { delivers: boolean }).delivers = true;
  assert.equal((await api.send('POST', '/api/jobs', { kind: 'wa.run' })).statusCode, 400);
  assert.equal((await api.send('POST', '/api/jobs', { kind: 'wa.run', confirm: 'ENVIAR' })).statusCode, 201);
  await waitForJob(api);
});

test('recusa por telefone: bloqueia para sempre, aparece nas supressões e a consulta acha', async () => {
  const api = createTestApi();
  seed(api, 2);
  await api.send('POST', '/api/whatsapp/draft');
  await api.send('POST', '/api/whatsapp/approve', { all: true });
  assert.equal((await api.send('POST', '/api/whatsapp/suppress', { phone: '(31) 99999-1001', reason: 'disse que não tem interesse' })).statusCode, 201);
  assert.equal((await api.send('POST', '/api/suppressions', { kind: 'phone', value: '+55 31 98888-0000', reason: 'pediu por telefone' })).statusCode, 201);
  assert.equal((await api.send('POST', '/api/suppressions', { kind: 'phone', value: 'abc', reason: 'x' })).statusCode, 400);

  const check = (await api.send('GET', '/api/suppressions/check?value=31999991001')).json();
  assert.deepEqual(check, { value: '+5531999991001', suppressed: true, by: 'phone' });
  assert.equal((await api.send('GET', '/api/suppressions/check?value=31977770000')).json().suppressed, false);

  const list = (await api.send('GET', '/api/suppressions')).json();
  assert.deepEqual(list.map((item: { kind: string }) => item.kind), ['phone', 'phone']);
  assert.equal(list.find((item: { lead?: { id: string } }) => item.lead)?.lead.id, 'lead-1');
  const view = (await api.send('GET', '/api/whatsapp')).json();
  assert.equal(view.counts.cancelled, 1);
  assert.equal(view.messages.find((message: { lead: { id: string } }) => message.lead.id === 'lead-1').lead.status, 'do_not_contact');
});
