import { DomainError } from '../errors.js';
import type { Deps } from '../ports/runtime.js';
import { resolveContact } from './contacts.js';
import { cancelInTransaction } from './messages.js';
import { computeQualification, saveQualification } from './qualification.js';
import { suppressEmailInTransaction } from './suppressions.js';
import { nowIso, record } from './shared.js';

const REDACTED = '[dado pessoal removido]';

// Erases a person's data on request (GDPR/LGPD) while keeping counts for metrics: the address
// becomes a permanent suppression hash, messages and history lose their personal content.
export const erasePersonalData = (deps: Deps, contactRef: string, reason: string): void => {
  if (!reason.trim()) throw new DomainError('validation', 'Informe --reason');
  deps.store.transaction(() => {
    const contact = resolveContact(deps, contactRef);
    if (contact.email) suppressEmailInTransaction(deps, contact.email, 'dados removidos a pedido', contact.companyId);
    for (const message of deps.store.messages.list({ contactId: contact.id })) {
      const pending = ['draft', 'approved', 'failed'].includes(message.status);
      const base = pending ? cancelInTransaction(deps, message, 'dados pessoais removidos') : message;
      deps.store.messages.update({ ...base, toEmail: REDACTED, subject: REDACTED, body: REDACTED, updatedAt: nowIso(deps) });
    }
    for (const reply of deps.store.replies.list({ contactId: contact.id })) deps.store.replies.update({ ...reply, summary: undefined, updatedAt: nowIso(deps) });
    deps.store.interactions.redactContact(contact.id, REDACTED);
    deps.store.contacts.update({
      ...contact,
      name: `[removido ${contact.id.slice(-8)}]`,
      email: undefined,
      source: undefined,
      profileUrl: undefined,
      notes: undefined,
      doNotContact: true,
      updatedAt: nowIso(deps),
    });
    const company = deps.store.companies.findById(contact.companyId)!;
    if (company.qualification) saveQualification(deps, company, computeQualification(deps, company));
    record(deps, { companyId: contact.companyId, contactId: contact.id, type: 'personal_data_erased', summary: `Dados pessoais de um contato removidos: ${reason}` });
  });
};
