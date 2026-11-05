import assert from 'node:assert/strict';
import test from 'node:test';
import { outreachSetup } from '../../testing/outreach.js';
import { approveTemplate, setTemplate } from './campaigns.js';
import { getCompanyHistory } from './companies.js';
import { draftDueFollowUps, listDueFollowUps } from './followups.js';
import { approveMessage, draftMessage } from './messages.js';
import { erasePersonalData } from './privacy.js';
import { correctReply, recordReply } from './replies.js';
import { sendApproved } from './send.js';
import { isSuppressed } from './outreach-shared.js';

const contacted = async () => {
  const context = outreachSetup();
  const draft = draftMessage(context.deps, context.campaign, { companyRef: 'acme.dev' });
  approveMessage(context.deps, draft.id);
  await sendApproved(context.deps, context.campaign);
  return context;
};

test('follow-up só vence depois do intervalo configurado em dias úteis', async () => {
  const context = await contacted();
  assert.equal(listDueFollowUps(context.deps).length, 0);
  context.advanceDays(6);
  assert.equal(listDueFollowUps(context.deps).length, 0);
  context.advanceDays(1);
  const [due] = listDueFollowUps(context.deps);
  assert.equal(due?.dueAt, '2026-11-02');
  assert.equal(due?.step, 1);
});

test('follow-up segue o template da etapa e respeita o máximo configurado', async () => {
  const context = await contacted();
  context.advanceDays(7);
  const { drafted } = draftDueFollowUps(context.deps, context.campaign);
  assert.equal(drafted.length, 1);
  assert.match(drafted[0]!.body, /just following up/);
  approveMessage(context.deps, drafted[0]!.id);
  await sendApproved(context.deps, context.campaign);
  assert.equal(context.email.sent.length, 2);
  context.advanceDays(30);
  assert.equal(listDueFollowUps(context.deps).length, 0);
  assert.match(getCompanyHistory(context.deps, 'acme.dev').company.nextActionNote!, /avaliar encerramento/);
});

test('resposta cancela follow-up pendente e move para replied', async () => {
  const context = await contacted();
  context.advanceDays(7);
  const [followUp] = draftDueFollowUps(context.deps, context.campaign).drafted;
  approveMessage(context.deps, followUp!.id);
  recordReply(context.deps, 'jane@acme.dev', { category: 'interested_to_talk', summary: 'Can we talk Thursday?' });
  assert.equal(context.deps.store.messages.findById(followUp!.id)!.status, 'cancelled');
  await sendApproved(context.deps, context.campaign);
  assert.equal(context.email.sent.length, 1);
  const company = getCompanyHistory(context.deps, 'acme.dev').company;
  assert.equal(company.status, 'replied');
  assert.match(company.nextActionNote!, /responder Jane Doe/);
  assert.equal(listDueFollowUps(context.deps).length, 0);
});

test('resposta automática não conta como resposta nem interrompe a sequência', async () => {
  const context = await contacted();
  recordReply(context.deps, 'jane@acme.dev', { category: 'auto_reply' });
  context.advanceDays(7);
  assert.equal(listDueFollowUps(context.deps).length, 1);
  assert.equal(context.deps.store.companies.findByDomain('acme.dev')!.status, 'contacted');
});

test('recusa encerra a empresa como not_interested', async () => {
  const context = await contacted();
  recordReply(context.deps, 'jane@acme.dev', { category: 'declined' });
  context.advanceDays(7);
  assert.equal(listDueFollowUps(context.deps).length, 0);
  assert.equal(context.deps.store.companies.findByDomain('acme.dev')!.status, 'not_interested');
});

test('pedido de interrupção suprime o e-mail e bloqueia a empresa', async () => {
  const context = await contacted();
  recordReply(context.deps, 'jane@acme.dev', { category: 'unsubscribe' });
  const contact = context.deps.store.contacts.findByEmail('jane@acme.dev')!;
  assert.equal(contact.doNotContact, true);
  assert.equal(isSuppressed(context.deps, 'JANE@acme.dev'), true);
  assert.equal(context.deps.store.companies.findByDomain('acme.dev')!.status, 'do_not_contact');
  context.advanceDays(30);
  assert.equal(listDueFollowUps(context.deps).length, 0);
});

test('endereço inválido marca o contato e não conta como resposta', async () => {
  const context = await contacted();
  recordReply(context.deps, 'jane@acme.dev', { category: 'invalid_address' });
  assert.equal(context.deps.store.contacts.findByEmail('jane@acme.dev')!.verificationStatus, 'invalid');
  assert.equal(context.deps.store.companies.findByDomain('acme.dev')!.status, 'contacted');
});

test('correção de classificação aplica o novo efeito e fica no histórico', async () => {
  const context = await contacted();
  const reply = recordReply(context.deps, 'jane@acme.dev', { category: 'inconclusive' });
  assert.equal(context.deps.store.companies.findByDomain('acme.dev')!.status, 'replied');
  correctReply(context.deps, reply.id, 'unsubscribe');
  assert.equal(context.deps.store.companies.findByDomain('acme.dev')!.status, 'do_not_contact');
  assert.ok(getCompanyHistory(context.deps, 'acme.dev').interactions.some((item) => item.type === 'reply_corrected'));
});

test('resposta ambígua nunca vira oportunidade automaticamente', async () => {
  const context = await contacted();
  recordReply(context.deps, 'jane@acme.dev', { category: 'interested_to_talk' });
  assert.equal(context.deps.store.companies.findByDomain('acme.dev')!.status, 'replied');
});

test('remoção de dados apaga o conteúdo pessoal e mantém o bloqueio', async () => {
  const context = await contacted();
  const contact = context.deps.store.contacts.findByEmail('jane@acme.dev')!;
  erasePersonalData(context.deps, 'jane@acme.dev', 'pedido por e-mail');
  const erased = context.deps.store.contacts.findById(contact.id)!;
  assert.equal(erased.email, undefined);
  assert.doesNotMatch(erased.name, /Jane/);
  assert.equal(isSuppressed(context.deps, 'jane@acme.dev'), true);
  const text = JSON.stringify(getCompanyHistory(context.deps, 'acme.dev')) + JSON.stringify(context.deps.store.messages.list({ contactId: contact.id }));
  assert.doesNotMatch(text, /Jane|jane@acme/);
  assert.equal(context.deps.store.messages.list({ contactId: contact.id })[0]!.status, 'sent');
});

const withThreeFollowUps = async () => {
  const context = await contacted();
  context.deps.sending = { ...context.deps.sending, followUp: { maxFollowUps: 3, intervalBusinessDays: [3, 5, 7] } };
  for (const step of [2, 3]) {
    setTemplate(context.deps, context.campaign, { step, subject: 'Re: extra capacity for {{company.name}}', body: `Hi {{contact.firstName}}, follow-up ${step}.` });
    approveTemplate(context.deps, context.campaign, step);
  }
  return context;
};

const sendDue = async (context: Awaited<ReturnType<typeof contacted>>) => {
  const [due] = draftDueFollowUps(context.deps, context.campaign).drafted;
  approveMessage(context.deps, due!.id);
  await sendApproved(context.deps, context.campaign);
  return due!;
};

test('follow-ups vencem 3, 5 e 7 dias úteis depois do primeiro e-mail, não do anterior', async () => {
  const context = await withThreeFollowUps();
  context.advanceDays(2);
  assert.equal(listDueFollowUps(context.deps).length, 0);
  context.advanceDays(1);
  assert.deepEqual(listDueFollowUps(context.deps).map((item) => [item.step, item.dueAt]), [[1, '2026-10-29']]);
  assert.equal((await sendDue(context)).step, 1);

  // First e-mail Mon 26/10: follow-up 2 is due Mon 02/11 (5 business days), not 5 days after the follow-up 1 send.
  context.advanceDays(3);
  assert.equal(listDueFollowUps(context.deps).length, 0);
  context.advanceDays(1);
  assert.deepEqual(listDueFollowUps(context.deps).map((item) => [item.step, item.dueAt]), [[2, '2026-11-02']]);
  assert.equal((await sendDue(context)).step, 2);

  context.advanceDays(3);
  assert.deepEqual(listDueFollowUps(context.deps).map((item) => [item.step, item.dueAt]), [[3, '2026-11-04']]);
  assert.equal((await sendDue(context)).step, 3);
  assert.equal(context.email.sent.length, 4);
  context.advanceDays(30);
  assert.equal(listDueFollowUps(context.deps).length, 0);
});

test('follow-up atrasado não faz o seguinte vencer no mesmo dia', async () => {
  const context = await withThreeFollowUps();
  context.advanceDays(10);
  assert.equal((await sendDue(context)).step, 1);
  assert.equal(listDueFollowUps(context.deps).length, 0);
  context.advanceDays(1);
  assert.deepEqual(listDueFollowUps(context.deps).map((item) => item.step), [2]);
});

test('follow-up sai como resposta na mesma conversa: In-Reply-To e References apontam para os e-mails anteriores', async () => {
  const context = await withThreeFollowUps();
  const first = context.deps.store.messages.list({ statuses: ['sent'] })[0]!;
  assert.deepEqual(Object.keys(context.email.sent[0]!.headers), ['List-Unsubscribe']);
  context.advanceDays(3);
  const second = await sendDue(context);
  assert.equal(context.email.sent[1]!.headers['In-Reply-To'], first.headerMessageId);
  assert.equal(context.email.sent[1]!.headers.References, first.headerMessageId);
  context.advanceDays(4);
  await sendDue(context);
  assert.equal(context.email.sent[2]!.headers['In-Reply-To'], second.headerMessageId);
  assert.equal(context.email.sent[2]!.headers.References, `${first.headerMessageId} ${second.headerMessageId}`);
});
