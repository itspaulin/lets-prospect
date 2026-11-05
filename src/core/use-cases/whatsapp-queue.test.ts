import assert from 'node:assert/strict';
import test from 'node:test';
import type { Lead } from '../entities/lead.js';
import { DomainError } from '../errors.js';
import { hashValue } from '../rules/render.js';
import { createTestDeps } from '../../testing/deps.js';
import {
  approveWhatsapp,
  cancelWhatsapp,
  draftWhatsapp,
  editWhatsapp,
  getWhatsapp,
  listWhatsapp,
  resolveUnknownWhatsapp,
  retryWhatsapp,
  runWhatsapp,
  sendWhatsapp,
  suppressPhone,
} from './whatsapp-queue.js';

type Ctx = ReturnType<typeof createTestDeps>;

const lead = (n: number, extra: Partial<Lead> = {}): Lead => ({
  id: `lead-${n}`,
  placeId: `place-${n}`,
  name: `Imob ${n} - Imobiliária Belo Horizonte`,
  phone: `+55313333${String(4000 + n)}`,
  phoneKind: 'landline',
  whatsapp: `+553199999${String(1000 + n)}`,
  whatsappSource: 'https://site.com.br/',
  enrichedAt: '2026-10-26T10:00:00.000Z',
  qualification: { verdict: 'fit', reason: 'imobiliária', signals: [], model: 'fake' },
  qualifiedAt: '2026-10-26T10:00:00.000Z',
  segment: 'imobiliária',
  status: 'identified',
  source: 'test',
  createdAt: '2026-10-26T10:00:00.000Z',
  updatedAt: '2026-10-26T10:00:00.000Z',
  ...extra,
});

const setup = (count = 3, extra: (n: number) => Partial<Lead> = () => ({})) => {
  const ctx = createTestDeps();
  for (let n = 1; n <= count; n++) ctx.deps.store.leads.insert(lead(n, extra(n)));
  return ctx;
};

const approved = (ctx: Ctx) => {
  draftWhatsapp(ctx.deps);
  approveWhatsapp(ctx.deps, 'all');
};

test('rascunho usa o nome curto do lead e o nome de quem envia, e não repete', () => {
  const { deps } = setup(2);
  const report = draftWhatsapp(deps);
  assert.equal(report.drafted.length, 2);
  assert.equal(report.drafted[0]!.body, 'Oi, aqui é o Maria Souza. Vi a Imob 1 e queria te mostrar uma ideia. Posso mandar?');
  assert.equal(report.drafted[0]!.status, 'draft');
  assert.equal(report.drafted[0]!.toPhone, '+5531999991001');
  assert.equal(draftWhatsapp(deps).drafted.length, 0);
});

test('rascunho pula lead sem WhatsApp, sem leitura do site, suprimido ou que já passou de identified', () => {
  const { deps } = setup(5, (n) => (n === 1 ? { whatsapp: undefined, enrichmentNote: 'o site não publica número de WhatsApp' } : n === 2 ? { whatsapp: undefined, enrichedAt: undefined } : n === 4 ? { status: 'contacted' } : {}));
  deps.store.suppressions.insert({ id: 'sup-1', kind: 'phone', valueHash: hashValue('+5531999991003'), reason: 'pediu para sair', createdAt: '2026-10-26T10:00:00.000Z' });
  const report = draftWhatsapp(deps);
  assert.deepEqual(report.drafted.map((item) => item.lead.id), ['lead-5']);
  assert.equal(listWhatsapp(deps).length, 1);
  assert.deepEqual(report.skipped.map((item) => item.reason), ['o site não publica número de WhatsApp', 'ainda sem leitura do site (rode lead enrich)', 'na lista de supressão']);
});

test('limite de rascunhos e placeholder desconhecido', () => {
  const { deps } = setup(3);
  assert.equal(draftWhatsapp(deps, { limit: 2 }).drafted.length, 2);
  deps.whatsapp = { ...deps.whatsapp, firstMessage: 'Oi {{lead.cnpj}}' };
  assert.throws(() => draftWhatsapp(deps), (error: unknown) => error instanceof DomainError && /Placeholder desconhecido/.test(error.message));
});

test('editar anula a aprovação; só rascunho vai para aprovada; vazio não vale', () => {
  const ctx = setup(1);
  const { deps } = ctx;
  draftWhatsapp(deps);
  const id = listWhatsapp(deps)[0]!.id;
  assert.throws(() => editWhatsapp(deps, id, '   '), (error: unknown) => error instanceof DomainError && error.code === 'validation');
  approveWhatsapp(deps, [id]);
  assert.equal(getWhatsapp(deps, id).status, 'approved');
  assert.equal(getWhatsapp(deps, id).contentHash, hashValue(getWhatsapp(deps, id).body));
  editWhatsapp(deps, id, 'Texto novo');
  assert.equal(getWhatsapp(deps, id).status, 'draft');
  assert.equal(getWhatsapp(deps, id).contentHash, undefined);
  approveWhatsapp(deps, [id.slice(0, 8)]);
  assert.throws(() => approveWhatsapp(deps, [id]), (error: unknown) => error instanceof DomainError && error.code === 'invalid_transition');
});

test('rascunho de número que mudou não é aprovado', () => {
  const { deps } = setup(1);
  draftWhatsapp(deps);
  deps.store.leads.update({ ...deps.store.leads.findById('lead-1')!, whatsapp: '+5531988880000' });
  assert.throws(() => approveWhatsapp(deps, 'all'), (error: unknown) => error instanceof DomainError && /número do lead mudou/.test(error.message));
});

test('envio manda os aprovados, marca o lead como contacted e espera entre as mensagens', async () => {
  const ctx = setup(3);
  approved(ctx);
  const report = await sendWhatsapp(ctx.deps);
  assert.deepEqual(report.outcomes.map((item) => item.outcome), ['sent', 'sent', 'sent']);
  assert.equal(ctx.whatsappChannel.sent.length, 3);
  assert.equal(ctx.whatsappChannel.sent[0]!.to, '+5531999991001');
  assert.equal(ctx.deps.store.leads.findById('lead-1')!.status, 'contacted');
  assert.deepEqual(ctx.sleeps, [120_000, 120_000]);
  assert.equal(report.remainingToday, 2);
  assert.equal(listWhatsapp(ctx.deps, ['sent']).length, 3);
  assert.ok(listWhatsapp(ctx.deps, ['sent']).every((message) => message.startedAt && message.sentAt));
});

test('a espera entre mensagens varia entre o mínimo e o máximo', async () => {
  const ctx = setup(2);
  ctx.deps.random = () => 1;
  approved(ctx);
  await sendWhatsapp(ctx.deps);
  assert.deepEqual(ctx.sleeps, [300_000]);
});

test('limite diário vale por dia local e sobra para o dia seguinte', async () => {
  const ctx = setup(7);
  approved(ctx);
  const first = await sendWhatsapp(ctx.deps);
  assert.equal(first.outcomes.filter((item) => item.outcome === 'sent').length, 5);
  assert.deepEqual(first.outcomes.slice(5).map((item) => item.detail), ['limite diário atingido', 'limite diário atingido']);
  assert.equal((await sendWhatsapp(ctx.deps)).outcomes.filter((item) => item.outcome === 'sent').length, 0);
  ctx.advanceDays(1);
  assert.equal((await sendWhatsapp(ctx.deps)).outcomes.filter((item) => item.outcome === 'sent').length, 2);
});

test('--limit corta o lote e dry-run não envia nem grava', async () => {
  const ctx = setup(3);
  approved(ctx);
  const dry = await sendWhatsapp(ctx.deps, { dryRun: true });
  assert.deepEqual(dry.outcomes.map((item) => item.outcome), ['would_send', 'would_send', 'would_send']);
  assert.equal(ctx.whatsappChannel.sent.length, 0);
  assert.equal(listWhatsapp(ctx.deps, ['approved']).length, 3);
  assert.equal((await sendWhatsapp(ctx.deps, { limit: 1 })).outcomes.filter((item) => item.outcome === 'sent').length, 1);
});

test('fora do horário ou no fim de semana nada é enviado', async () => {
  const ctx = setup(2);
  approved(ctx);
  ctx.advanceDays(0.5);
  const night = await sendWhatsapp(ctx.deps);
  assert.equal(night.outcomes.length, 0);
  assert.match(night.stopped!, /fora do horário/);
  ctx.advanceDays(4.5);
  assert.match((await sendWhatsapp(ctx.deps)).stopped!, /fora do horário/);
  assert.equal(ctx.whatsappChannel.sent.length, 0);
  ctx.advanceDays(2);
  assert.equal((await sendWhatsapp(ctx.deps)).outcomes.length, 2);
});

test('para quando a janela fecha no meio do lote', async () => {
  const ctx = setup(3);
  approved(ctx);
  ctx.deps.sleep = async () => ctx.advanceDays(0.375);
  const report = await sendWhatsapp(ctx.deps);
  assert.equal(report.outcomes.filter((item) => item.outcome === 'sent').length, 1);
  assert.match(report.stopped!, /saiu do horário/);
});

test('falhas seguidas param o envio; falha não marca como enviada e pode voltar para a fila', async () => {
  const ctx = setup(5);
  approved(ctx);
  ctx.whatsappChannel.next = () => ({ status: 'failed', error: 'número não tem WhatsApp' });
  const report = await sendWhatsapp(ctx.deps);
  assert.equal(report.outcomes.length, 3);
  assert.match(report.stopped!, /3 falhas seguidas/);
  assert.equal(ctx.deps.store.leads.findById('lead-1')!.status, 'identified');
  const failed = listWhatsapp(ctx.deps, ['failed']);
  assert.equal(failed.length, 3);
  ctx.whatsappChannel.next = () => ({ status: 'sent' });
  retryWhatsapp(ctx.deps, failed[0]!.id);
  // The three failed attempts already count against today's limit of 5, so only two more go out.
  assert.equal((await sendWhatsapp(ctx.deps)).outcomes.filter((item) => item.outcome === 'sent').length, 2);
});

test('um sucesso zera a contagem de falhas seguidas', async () => {
  const ctx = setup(5);
  approved(ctx);
  let calls = 0;
  ctx.whatsappChannel.next = () => (++calls % 2 === 1 ? { status: 'failed', error: 'x' } : { status: 'sent' });
  const report = await sendWhatsapp(ctx.deps);
  assert.equal(report.outcomes.length, 5);
  assert.equal(report.stopped, undefined);
});

test('conta bloqueada encerra a rodada na hora', async () => {
  const ctx = setup(3);
  approved(ctx);
  ctx.whatsappChannel.next = () => ({ status: 'blocked', error: 'conta restrita' });
  const report = await sendWhatsapp(ctx.deps);
  assert.equal(report.outcomes.length, 1);
  assert.match(report.stopped!, /bloqueada ou restrita/);
  assert.equal(listWhatsapp(ctx.deps, ['approved']).length, 2);
});

test('erro inesperado vira unknown e nunca é reenviado sozinho; conciliar resolve', async () => {
  const ctx = setup(2);
  approved(ctx);
  ctx.whatsappChannel.next = () => {
    throw new Error('conexão caiu');
  };
  const report = await sendWhatsapp(ctx.deps, { limit: 1 });
  assert.equal(report.outcomes[0]!.outcome, 'unknown');
  const unknown = listWhatsapp(ctx.deps, ['unknown'])[0]!;
  ctx.whatsappChannel.next = () => ({ status: 'sent' });
  await sendWhatsapp(ctx.deps);
  assert.equal(listWhatsapp(ctx.deps, ['unknown']).length, 1);
  assert.equal(resolveUnknownWhatsapp(ctx.deps, unknown.id, true).status, 'sent');
  assert.equal(ctx.deps.store.leads.findById(unknown.leadId)!.status, 'contacted');
  assert.throws(() => resolveUnknownWhatsapp(ctx.deps, unknown.id, true), (error: unknown) => error instanceof DomainError && error.code === 'invalid_transition');
});

test('mensagem presa em sending por execução interrompida vira unknown, e "não enviada" volta à fila', async () => {
  const ctx = setup(1);
  approved(ctx);
  const [message] = listWhatsapp(ctx.deps);
  ctx.deps.store.waMessages.claim(message!.id, '2026-10-26T11:00:00.000Z');
  await sendWhatsapp(ctx.deps);
  assert.equal(getWhatsapp(ctx.deps, message!.id).status, 'unknown');
  assert.equal(ctx.whatsappChannel.sent.length, 0);
  assert.equal(resolveUnknownWhatsapp(ctx.deps, message!.id, false).status, 'approved');
});

test('recusa: suprimir o telefone cancela o que estava na fila e bloqueia para sempre', async () => {
  const ctx = setup(2);
  approved(ctx);
  assert.equal(suppressPhone(ctx.deps, '(31) 99999-1001', 'disse que não tem interesse'), true);
  assert.equal(suppressPhone(ctx.deps, '+5531999991001', 'de novo'), false);
  assert.equal(ctx.deps.store.leads.findById('lead-1')!.status, 'do_not_contact');
  assert.equal(listWhatsapp(ctx.deps, ['cancelled']).length, 1);
  const report = await sendWhatsapp(ctx.deps);
  assert.equal(report.outcomes.length, 1);
  assert.equal(ctx.whatsappChannel.sent[0]!.to, '+5531999991002');
  assert.throws(() => suppressPhone(ctx.deps, 'abc', 'x'), (error: unknown) => error instanceof DomainError && error.code === 'validation');
});

test('na hora de enviar: lead suprimido depois da aprovação é cancelado, texto adulterado é pulado', async () => {
  const ctx = setup(3);
  approved(ctx);
  ctx.deps.store.suppressions.insert({ id: 'sup-1', kind: 'phone', valueHash: hashValue('+5531999991001'), reason: 'x', createdAt: '2026-10-26T10:00:00.000Z' });
  const tampered = listWhatsapp(ctx.deps)[1]!;
  ctx.deps.store.waMessages.update({ ...tampered, body: 'outro texto' });
  const report = await sendWhatsapp(ctx.deps);
  assert.deepEqual(report.outcomes.map((item) => [item.outcome, item.detail]), [['cancelled', 'na lista de supressão'], ['skipped', 'conteúdo alterado depois da aprovação'], ['sent', undefined]]);
});

test('lead que já respondeu ou mudou de status não recebe a abertura', async () => {
  const ctx = setup(1);
  approved(ctx);
  ctx.deps.store.leads.update({ ...ctx.deps.store.leads.findById('lead-1')!, status: 'replied' });
  const report = await sendWhatsapp(ctx.deps);
  assert.equal(report.outcomes[0]!.outcome, 'cancelled');
  assert.equal(ctx.whatsappChannel.sent.length, 0);
});

test('um envio por vez', async () => {
  const ctx = setup(1);
  approved(ctx);
  assert.ok(ctx.deps.store.locks.acquire('send-whatsapp', 'other', '2026-10-26T12:00:00.000Z', '2026-10-26T11:30:00.000Z'));
  await assert.rejects(sendWhatsapp(ctx.deps), (error: unknown) => error instanceof DomainError && /em andamento/.test(error.message));
});

test('cancelar exige motivo e só vale para rascunho, aprovada ou falha', async () => {
  const ctx = setup(2);
  draftWhatsapp(ctx.deps);
  const [first, second] = listWhatsapp(ctx.deps);
  assert.throws(() => cancelWhatsapp(ctx.deps, first!.id, ' '), (error: unknown) => error instanceof DomainError && error.code === 'validation');
  assert.equal(cancelWhatsapp(ctx.deps, first!.id, 'não faz sentido').status, 'cancelled');
  assert.throws(() => cancelWhatsapp(ctx.deps, first!.id, 'de novo'), (error: unknown) => error instanceof DomainError && error.code === 'invalid_transition');
  assert.ok(second);
});

test('com autoApprove as mensagens já nascem aprovadas e saem sem ninguém aprovar', async () => {
  const ctx = setup(2);
  ctx.deps.whatsapp = { ...ctx.deps.whatsapp, autoApprove: true };
  const report = draftWhatsapp(ctx.deps);
  assert.deepEqual(report.drafted.map((item) => item.status), ['approved', 'approved']);
  assert.ok(report.drafted.every((item) => item.contentHash && item.approvedAt));
  assert.equal((await sendWhatsapp(ctx.deps)).outcomes.filter((item) => item.outcome === 'sent').length, 2);
});

test('sem autoApprove o rascunho espera aprovação, e o envio não manda rascunho', async () => {
  const ctx = setup(1);
  draftWhatsapp(ctx.deps);
  const report = await sendWhatsapp(ctx.deps);
  assert.equal(report.outcomes.length, 0);
  assert.equal(ctx.whatsappChannel.sent.length, 0);
});

test('run: lê o site, prepara e envia de uma vez, e uma segunda chamada não repete nada', async () => {
  const ctx = setup(2, () => ({ whatsapp: undefined, enrichedAt: undefined, qualification: undefined, qualifiedAt: undefined, website: 'https://imob.com.br' }));
  ctx.deps.whatsapp = { ...ctx.deps.whatsapp, autoApprove: true };
  ctx.deps.pages = {
    fetchRaw: async (domain: string) => ({ pages: [{ url: `https://${domain}/`, html: '<a href="https://wa.me/5531999990000">x</a>' }] }),
  };
  ctx.deps.leadsConfig = { ...ctx.deps.leadsConfig, discovery: { ...ctx.deps.leadsConfig.discovery, minCandidates: 0 } };
  const sentence = 'Somos uma imobiliária com mais de vinte anos vendendo e alugando imóveis na região.';
  ctx.deps.qualifying = { fetcher: { fetchSite: async (domain: string) => ({ pages: [{ url: `https://${domain}/`, text: sentence }] }) }, qualifier: undefined as never };
  ctx.deps.leadQualifier = { name: 'fake ai', qualify: async () => ({ verdict: 'fit', reason: 'imobiliária', signals: [{ kind: 'activity', claim: 'vende e aluga', quote: sentence, pageUrl: 'https://imob.com.br/' }] }) };
  const report = await runWhatsapp(ctx.deps);
  assert.equal(report.qualified!.results.filter((item) => item.outcome === 'fit').length, 2);
  assert.equal(report.enriched!.found.length, 2);
  assert.equal(report.drafted!.drafted.length, 2);
  assert.equal(report.sent.outcomes.filter((item) => item.outcome === 'sent').length, 2);
  assert.equal(ctx.whatsappChannel.sent[0]!.to, '+5531999990000');
  const again = await runWhatsapp(ctx.deps);
  assert.equal(again.drafted!.drafted.length, 0);
  assert.equal(again.sent.outcomes.length, 0);
});

test('run --dry-run só mostra o que enviaria, sem ler site nem preparar nada', async () => {
  const ctx = setup(1);
  ctx.deps.whatsapp = { ...ctx.deps.whatsapp, autoApprove: true };
  draftWhatsapp(ctx.deps);
  const report = await runWhatsapp(ctx.deps, { dryRun: true });
  assert.equal(report.enriched, undefined);
  assert.equal(report.drafted, undefined);
  assert.equal(report.sent.outcomes[0]!.outcome, 'would_send');
  assert.equal(ctx.whatsappChannel.sent.length, 0);
});

test('ninguém é contatado antes de a IA aprovar: sem veredito, descartado ou em dúvida ficam de fora do rascunho', () => {
  const { deps } = setup(4, (n) =>
    n === 1 ? { qualification: undefined, qualifiedAt: undefined } : n === 2 ? { qualification: { verdict: 'not_a_fit', reason: 'é um portal', signals: [], model: 'fake' } } : n === 3 ? { qualification: { verdict: 'unclear', reason: 'pouco texto', signals: [], model: 'fake' } } : {},
  );
  const report = draftWhatsapp(deps);
  assert.deepEqual(report.drafted.map((item) => item.lead.id), ['lead-4']);
  assert.deepEqual(report.skipped.map((item) => item.reason), ['ainda não qualificado pela IA (rode lead qualify)', 'IA: não é um bom perfil. é um portal', 'IA: dúvida, precisa de revisão. pouco texto']);
});
