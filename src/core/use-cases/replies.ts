import { z } from 'zod';
import type { Company } from '../entities/company.js';
import type { Contact } from '../entities/contact.js';
import { REPLY_CATEGORIES, type Reply, type ReplyCategory } from '../entities/outreach.js';
import { DomainError } from '../errors.js';
import type { Deps } from '../ports/runtime.js';
import { allowedTransitions } from '../rules/company-status.js';
import { REPLY_EFFECTS } from '../rules/replies.js';
import { resolveContact } from './contacts.js';
import { cancelInTransaction } from './messages.js';
import { suppressEmailInTransaction } from './suppressions.js';
import { isoDate, nowIso, parseInput, record, today } from './shared.js';

const moveCompany = (deps: Deps, company: Company, to: Company['status'], reason: string): Company => {
  if (company.status === to || !allowedTransitions(company.status).includes(to)) return company;
  const updated: Company = { ...company, status: to, updatedAt: nowIso(deps) };
  deps.store.companies.update(updated);
  record(deps, { companyId: company.id, type: 'status_changed', summary: `${company.status} -> ${to}: ${reason}`, data: { from: company.status, to, reason } });
  return updated;
};

// Effects only add restrictions (cancel pending messages, suppress, close the company). A later
// correction never lifts a suppression; that stays a deliberate manual action.
const applyEffects = (deps: Deps, reply: Reply, contact: Contact): void => {
  const effect = REPLY_EFFECTS[reply.category];
  let company = deps.store.companies.findById(reply.companyId)!;

  if (effect.stopsSequence)
    for (const message of deps.store.messages.list({ companyId: company.id, statuses: ['draft', 'approved', 'failed'] }))
      cancelInTransaction(deps, message, `resposta recebida (${reply.category})`);

  if (effect.invalidContact && contact.verificationStatus !== 'invalid') {
    deps.store.contacts.update({ ...contact, verificationStatus: 'invalid', updatedAt: nowIso(deps) });
    record(deps, { companyId: company.id, contactId: contact.id, type: 'contact_updated', summary: `Contato ${contact.name}: e-mail inválido (retorno)` });
  }
  if (effect.suppressContact && contact.email) {
    suppressEmailInTransaction(deps, contact.email, reply.category === 'unsubscribe' ? 'pediu para não receber mensagens' : 'endereço inválido', company.id);
    const fresh = deps.store.contacts.findById(contact.id)!;
    if (!fresh.doNotContact) deps.store.contacts.update({ ...fresh, doNotContact: true, updatedAt: nowIso(deps) });
  }

  if (effect.countsAsResponse && company.status === 'contacted' && !effect.companyStatus) company = moveCompany(deps, company, 'replied', `resposta ${reply.category}`);
  if (effect.companyStatus) company = moveCompany(deps, company, effect.companyStatus, `resposta ${reply.category}`);

  if (effect.countsAsResponse && !['do_not_contact', 'not_interested'].includes(company.status)) {
    deps.store.companies.update({ ...company, nextActionAt: today(deps), nextActionNote: `responder ${contact.name} (${reply.category})`, updatedAt: nowIso(deps) });
  } else if (effect.companyStatus) {
    deps.store.companies.update({ ...company, nextActionAt: undefined, nextActionNote: undefined, updatedAt: nowIso(deps) });
  }
};

const schema = z.object({
  category: z.enum(REPLY_CATEGORIES),
  summary: z.string().trim().min(1).optional(),
  receivedAt: isoDate.optional(),
  messageId: z.string().optional(),
});

export const recordReply = (deps: Deps, contactRef: string, input: z.input<typeof schema>): Reply => {
  const data = parseInput(schema, input);
  return deps.store.transaction(() => {
    const contact = resolveContact(deps, contactRef);
    const messageId = data.messageId ?? deps.store.messages.list({ contactId: contact.id, statuses: ['sent'] }).at(-1)?.id;
    if (data.messageId && deps.store.messages.findById(data.messageId)?.contactId !== contact.id)
      throw new DomainError('validation', 'A mensagem informada não é deste contato');
    const now = nowIso(deps);
    const reply: Reply = { id: deps.newId(), companyId: contact.companyId, contactId: contact.id, messageId, category: data.category, summary: data.summary, receivedAt: data.receivedAt ?? today(deps), createdAt: now, updatedAt: now };
    deps.store.replies.insert(reply);
    record(deps, {
      companyId: contact.companyId,
      contactId: contact.id,
      type: 'reply_recorded',
      summary: `Resposta de ${contact.name}: ${reply.category}${reply.summary ? ` — ${reply.summary}` : ''}`,
      data: { replyId: reply.id, messageId },
    });
    applyEffects(deps, reply, contact);
    return reply;
  });
};

export const correctReply = (deps: Deps, replyId: string, category: ReplyCategory): Reply =>
  deps.store.transaction(() => {
    const reply = deps.store.replies.findById(replyId);
    if (!reply) throw new DomainError('not_found', `Resposta não encontrada: ${replyId}`);
    parseInput(z.enum(REPLY_CATEGORIES), category);
    if (reply.category === category) return reply;
    const updated: Reply = { ...reply, category, updatedAt: nowIso(deps) };
    deps.store.replies.update(updated);
    record(deps, { companyId: reply.companyId, contactId: reply.contactId, type: 'reply_corrected', summary: `Classificação corrigida: ${reply.category} -> ${category}`, data: { replyId } });
    applyEffects(deps, updated, deps.store.contacts.findById(reply.contactId)!);
    return updated;
  });

export const listReplies = (deps: Deps, filter: { companyId?: string } = {}): Reply[] => deps.store.replies.list(filter);
