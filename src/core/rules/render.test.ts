import assert from 'node:assert/strict';
import test from 'node:test';
import { DomainError } from '../errors.js';
import { assertTemplatePlaceholders, contentHash, renderMessage } from './render.js';
import { addBusinessDays } from './business-days.js';

const template = { subject: 'Hi {{contact.firstName}}', body: 'Hello {{contact.firstName}},\n\n{{reason}}\n\nI work with {{stack}}.\nThanks' };
const context = {
  company: { name: 'Acme', matchingTechnologies: ['React'] },
  contact: { name: 'Jane Doe' },
  sender: { name: 'Maria', email: 'p@x.dev', postalAddress: 'PO Box 1' },
};
const footer = '{{sender.name}}\n{{sender.postalAddress}}\nReply "unsubscribe" to stop.';

test('com motivo verificado a mensagem é personalizada e leva rodapé', () => {
  const result = renderMessage(template, footer, { ...context, reason: 'Saw your case study on fintech.' });
  assert.equal(result.personalization, 'evidence_based');
  assert.equal(result.subject, 'Hi Jane');
  assert.match(result.body, /Saw your case study/);
  assert.match(result.body, /PO Box 1\nReply "unsubscribe" to stop\.$/);
});

test('sem motivo a linha some e a mensagem fica marcada como genérica', () => {
  const result = renderMessage(template, footer, { ...context, company: { name: 'Acme', matchingTechnologies: [] } });
  assert.equal(result.personalization, 'generic');
  assert.doesNotMatch(result.body, /\{\{|I work with/);
  assert.equal(result.body.startsWith('Hello Jane,\n\nThanks'), true);
});

test('remetente sem endereço postal impede o rascunho', () => {
  assert.throws(() => renderMessage(template, footer, { ...context, sender: { ...context.sender, postalAddress: '' } }), /SENDER_POSTAL_ADDRESS/);
});

test('placeholder desconhecido é recusado no template', () => {
  assert.throws(() => assertTemplatePlaceholders('Hi {{contact.nickname}}'), DomainError);
  assertTemplatePlaceholders('Hi {{contact.firstName}} {{ company.name }}');
});

test('hash muda com qualquer alteração de destinatário, assunto ou corpo', () => {
  const base = { toEmail: 'a@x.dev', subject: 's', body: 'b' };
  assert.notEqual(contentHash(base), contentHash({ ...base, body: 'b ' }));
  assert.notEqual(contentHash(base), contentHash({ ...base, toEmail: 'b@x.dev' }));
  assert.equal(contentHash(base), contentHash({ ...base }));
});

test('dias úteis pulam fim de semana', () => {
  assert.equal(addBusinessDays('2026-10-30', 1), '2026-11-02');
  assert.equal(addBusinessDays('2026-10-26T12:00:00Z', 5), '2026-11-02');
});

test('a stack vira lista em português: "A", "A e B", "A, B e C"', () => {
  const body = (technologies: string[]) =>
    renderMessage({ subject: 's', body: 'Uso {{stack}}.' }, 'f', { company: { name: 'X', matchingTechnologies: technologies }, contact: { name: 'Ana' }, sender: { name: 'P', postalAddress: 'a', email: 'p@x.dev' } }).body.split('\n')[0];
  assert.equal(body(['Node.js']), 'Uso Node.js.');
  assert.equal(body(['Node.js', 'React']), 'Uso Node.js e React.');
  assert.equal(body(['Node.js', 'React', 'AWS']), 'Uso Node.js, React e AWS.');
});
