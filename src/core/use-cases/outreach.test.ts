import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestDeps } from '../../testing/deps.js';
import { FIRST_TEMPLATE, outreachSetup, qualifiedCompany } from '../../testing/outreach.js';
import { DomainError } from '../errors.js';
import { activateCampaign, addTarget, approveTemplate, createCampaign, pauseCampaign, selectTargets, setTemplate } from './campaigns.js';
import { getCompanyHistory } from './companies.js';
import { updateContact } from './contacts.js';
import { approveMessage, draftAll, draftMessage, editMessage, retryFailedMessage } from './messages.js';
import { listReadyForContact } from './outreach-shared.js';
import { resolveUnknown, sendApproved } from './send.js';
import { suppressDomain } from './suppressions.js';

const code = (expected: DomainError['code']) => (error: unknown) => error instanceof DomainError && error.code === expected;

const approvedDraft = (context: ReturnType<typeof outreachSetup>, reason?: string) => {
  const message = draftMessage(context.deps, context.campaign, { companyRef: 'acme.dev', reason, evidenceIds: reason ? [context.evidence.id] : undefined });
  return approveMessage(context.deps, message.id);
};

test('campanha só é ativada com template aprovado; template aprovado é imutável', () => {
  const { deps, db } = createTestDeps();
  createCampaign(deps, { name: 'c1' });
  assert.throws(() => activateCampaign(deps, 'c1'), code('requirement_missing'));
  const template = setTemplate(deps, 'c1', { step: 0, ...FIRST_TEMPLATE });
  approveTemplate(deps, 'c1', 0);
  assert.throws(() => db.prepare("UPDATE templates SET body = 'x' WHERE id = ?").run(template.id), /immutable/);
  assert.equal(setTemplate(deps, 'c1', { step: 0, ...FIRST_TEMPLATE }).version, 2);
  assert.equal(activateCampaign(deps, 'c1').status, 'active');
  assert.throws(() => setTemplate(deps, 'c1', { step: 2, ...FIRST_TEMPLATE }), /máximo de follow-ups/);
});

test('empresa não entra em duas campanhas abertas nem sem estar qualificada', () => {
  const context = outreachSetup();
  createCampaign(context.deps, { name: 'outra' });
  assert.throws(() => addTarget(context.deps, 'outra', 'acme.dev'), code('duplicate'));
  const { deps } = createTestDeps();
  qualifiedCompany(deps);
  createCampaign(deps, { name: 'c' });
  assert.equal(listReadyForContact(deps).length, 1);
  const selection = selectTargets(deps, 'c', {});
  assert.equal(selection.added.length, 1);
  assert.equal(listReadyForContact(deps).length, 0);
});

test('personalização exige fato verificado; sem motivo o rascunho é genérico', () => {
  const context = outreachSetup();
  assert.throws(() => draftMessage(context.deps, context.campaign, { companyRef: 'acme.dev', reason: 'Loved your blog' }), /--evidence/);
  const generic = draftMessage(context.deps, context.campaign, { companyRef: 'acme.dev' });
  assert.equal(generic.personalization, 'generic');
  assert.equal(generic.subject, 'Extra React e Node.js capacity for Acme Software Ltd');
  const personal = draftMessage(context.deps, context.campaign, { companyRef: 'acme.dev', reason: 'I read your fintech case study.', evidenceIds: [context.evidence.id] });
  assert.equal(personal.id, generic.id);
  assert.equal(personal.personalization, 'evidence_based');
  assert.match(personal.body, /fintech case study/);
  assert.match(personal.body, /PO Box 1/);
});

test('envio bem-sucedido registra resultado, histórico e move a empresa para contacted', async () => {
  const context = outreachSetup();
  const approved = approvedDraft(context, 'I read your fintech case study.');
  const report = await sendApproved(context.deps, context.campaign);
  assert.deepEqual(report.outcomes.map((item) => item.outcome), ['sent']);
  const [email] = context.email.sent;
  assert.equal(email!.to, 'jane@acme.dev');
  assert.equal(email!.text, approved.body);
  assert.equal(email!.headerMessageId, approved.headerMessageId);
  assert.match(email!.headers['List-Unsubscribe']!, /mailto:maria@example\.dev/);

  const message = context.deps.store.messages.findById(approved.id)!;
  assert.equal(message.status, 'sent');
  assert.equal(message.providerMessageId, 'provider-1');
  assert.equal(message.campaignId, context.deps.store.campaigns.findByName(context.campaign)!.id);
  assert.equal(message.companyId, context.company.id);
  const history = getCompanyHistory(context.deps, 'acme.dev');
  assert.equal(history.company.status, 'contacted');
  assert.equal(history.company.nextActionAt, '2026-11-02');
  assert.deepEqual(history.interactions.slice(-2).map((item) => item.type), ['status_changed', 'message_sent']);
  assert.equal(context.deps.store.attempts.listByMessage(approved.id)[0]!.outcome, 'sent');
});

test('falha do provedor não marca como enviada e pode ser reenviada explicitamente', async () => {
  const context = outreachSetup();
  const approved = approvedDraft(context);
  context.email.next = () => ({ status: 'failed', error: '550 mailbox unavailable' });
  const report = await sendApproved(context.deps, context.campaign);
  assert.equal(report.outcomes[0]!.outcome, 'failed');
  const failed = context.deps.store.messages.findById(approved.id)!;
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, '550 mailbox unavailable');
  assert.equal(failed.sentAt, undefined);
  assert.equal(context.deps.store.companies.findByDomain('acme.dev')!.status, 'qualified');

  assert.equal((await sendApproved(context.deps, context.campaign)).outcomes.length, 0);
  retryFailedMessage(context.deps, approved.id);
  context.email.next = () => ({ status: 'sent', providerMessageId: 'ok' });
  assert.equal((await sendApproved(context.deps, context.campaign)).outcomes[0]!.outcome, 'sent');
  assert.deepEqual(context.deps.store.attempts.listByMessage(approved.id).map((attempt) => attempt.outcome), ['failed', 'sent']);
});

test('reexecutar o envio não duplica mensagens', async () => {
  const context = outreachSetup();
  approvedDraft(context);
  await sendApproved(context.deps, context.campaign);
  await sendApproved(context.deps, context.campaign);
  assert.equal(context.email.sent.length, 1);
  assert.throws(() => approvedDraft(context), /já está sent/);
});

test('erro inesperado ou queda durante o envio vira unknown e nunca é reenviado sozinho', async () => {
  const context = outreachSetup();
  const approved = approvedDraft(context);
  context.email.next = () => {
    throw new Error('socket hang up');
  };
  assert.equal((await sendApproved(context.deps, context.campaign)).outcomes[0]!.outcome, 'unknown');
  context.email.next = () => ({ status: 'sent' });
  await sendApproved(context.deps, context.campaign);
  assert.equal(context.email.sent.length, 0);
  assert.equal(context.deps.store.messages.findById(approved.id)!.status, 'unknown');

  resolveUnknown(context.deps, approved.id, true, 'consta na pasta Enviados');
  assert.equal(context.deps.store.messages.findById(approved.id)!.status, 'sent');
  assert.equal(context.deps.store.companies.findByDomain('acme.dev')!.status, 'contacted');
});

test('mensagem presa em sending por execução interrompida é recuperada como unknown', async () => {
  const context = outreachSetup();
  const approved = approvedDraft(context);
  context.deps.store.messages.claim(approved.id, '2026-10-26T12:00:00.000Z');
  await sendApproved(context.deps, context.campaign);
  assert.equal(context.email.sent.length, 0);
  assert.equal(context.deps.store.messages.findById(approved.id)!.status, 'unknown');
  resolveUnknown(context.deps, approved.id, false);
  await sendApproved(context.deps, context.campaign);
  assert.equal(context.email.sent.length, 1);
});

test('conteúdo alterado depois da aprovação não é enviado', async () => {
  const context = outreachSetup();
  const approved = approvedDraft(context);
  context.db.prepare("UPDATE messages SET body = body || ' P.S. extra' WHERE id = ?").run(approved.id);
  const report = await sendApproved(context.deps, context.campaign);
  assert.equal(report.outcomes[0]!.outcome, 'cancelled');
  assert.match(report.outcomes[0]!.detail!, /alterado/);
  assert.equal(context.email.sent.length, 0);
});

test('editar volta para rascunho e exige nova aprovação', async () => {
  const context = outreachSetup();
  const approved = approvedDraft(context);
  const edited = editMessage(context.deps, approved.id, { subject: approved.subject, body: `${approved.body}\nP.S. hi` });
  assert.equal(edited.status, 'draft');
  assert.equal((await sendApproved(context.deps, context.campaign)).outcomes.length, 0);
  approveMessage(context.deps, approved.id);
  await sendApproved(context.deps, context.campaign);
  assert.match(context.email.sent[0]!.text, /P\.S\. hi/);
});

test('contato bloqueado, suprimido ou com e-mail trocado não recebe', async () => {
  for (const block of [
    (context: ReturnType<typeof outreachSetup>) => updateContact(context.deps, 'jane@acme.dev', { doNotContact: true }),
    (context: ReturnType<typeof outreachSetup>) => suppressDomain(context.deps, 'acme.dev', 'pediu para não contatar ninguém'),
    (context: ReturnType<typeof outreachSetup>) => updateContact(context.deps, 'jane@acme.dev', { email: 'jane.doe@acme.dev' }),
    (context: ReturnType<typeof outreachSetup>) => updateContact(context.deps, 'jane@acme.dev', { verificationStatus: 'invalid' }),
  ]) {
    const context = outreachSetup();
    approvedDraft(context);
    block(context);
    const report = await sendApproved(context.deps, context.campaign);
    assert.equal(report.outcomes[0]!.outcome, 'cancelled', report.outcomes[0]!.detail);
    assert.equal(context.email.sent.length, 0);
  }
});

test('campanha pausada segura o envio sem cancelar; dry-run não envia', async () => {
  const context = outreachSetup();
  const approved = approvedDraft(context);
  assert.equal((await sendApproved(context.deps, context.campaign, { dryRun: true })).outcomes[0]!.outcome, 'would_send');
  pauseCampaign(context.deps, context.campaign);
  const report = await sendApproved(context.deps, context.campaign);
  assert.equal(report.outcomes[0]!.outcome, 'skipped');
  assert.equal(context.deps.store.messages.findById(approved.id)!.status, 'approved');
  assert.equal(context.email.sent.length, 0);
});

test('limite diário e intervalo entre envios', async () => {
  const context = createTestDeps();
  const { deps } = context;
  createCampaign(deps, { name: 'c' });
  setTemplate(deps, 'c', { step: 0, ...FIRST_TEMPLATE });
  approveTemplate(deps, 'c', 0);
  activateCampaign(deps, 'c');
  deps.sending = { ...deps.sending, dailyLimit: 2 };
  for (const [index, domain] of ['a.dev', 'b.dev', 'c.dev'].entries()) {
    qualifiedCompany(deps, { name: `Company ${index}`, website: domain, source: domain }, `cto@${domain}`);
  }
  selectTargets(deps, 'c', {});
  for (const message of draftAll(deps, 'c').drafted) approveMessage(deps, message.id);
  const report = await sendApproved(deps, 'c');
  assert.deepEqual(report.outcomes.map((item) => item.outcome), ['sent', 'sent', 'skipped']);
  assert.equal(report.outcomes[2]!.detail, 'limite diário atingido');
  assert.deepEqual(context.sleeps, [90_000]);
  context.advanceDays(1);
  assert.equal((await sendApproved(deps, 'c')).outcomes[0]!.outcome, 'sent');
});

test('um envio por vez', async () => {
  const context = outreachSetup();
  approvedDraft(context);
  context.deps.store.locks.acquire('send', 'outro processo', '2026-10-26T11:59:00.000Z', '2026-10-26T11:00:00.000Z');
  await assert.rejects(sendApproved(context.deps, context.campaign), /envio em andamento/);
});

test('campanha de um tipo só recebe empresas desse tipo; empresa sem tipo fica de fora com o motivo', () => {
  const { deps } = createTestDeps();
  qualifiedCompany(deps, { website: 'https://www.casa.dev', segment: 'software house' } as never, 'ana@casa.dev');
  qualifiedCompany(deps, { website: 'https://www.consult.dev', segment: 'consultoria de TI' } as never, 'bia@consult.dev');
  qualifiedCompany(deps, { website: 'https://www.manual.dev' }, 'cleo@manual.dev');
  createCampaign(deps, { name: 'br-consultorias', market: 'BR', segment: 'consultoria de TI' });
  const picked = selectTargets(deps, 'br-consultorias', {});
  assert.deepEqual(picked.added.map((item) => item.company.domain), ['consult.dev']);
  assert.deepEqual(picked.skipped.map((item) => [item.company.domain, item.reason]), [
    ['casa.dev', 'é software house; a campanha é de consultoria de TI'],
    ['manual.dev', 'sem tipo definido; a campanha é de consultoria de TI'],
  ]);
  // A free-text segment is only a description: it does not filter.
  createCampaign(deps, { name: 'br-livre', market: 'BR', segment: 'agências Node/React' });
  assert.equal(selectTargets(deps, 'br-livre', {}).added.length, 2);
});
