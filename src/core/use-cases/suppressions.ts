import { DomainError } from '../errors.js';
import type { Deps } from '../ports/runtime.js';
import { emailDomain, normalizeDomain, normalizeEmail } from '../rules/normalize.js';
import { hashValue } from '../rules/render.js';
import { record } from './shared.js';
import { nowIso } from './shared.js';

// Suppressions keep only a hash, so an address stays blocked even after the person's data is erased.
export const suppressEmailInTransaction = (deps: Deps, email: string, reason: string, companyId?: string): boolean => {
  const normalized = normalizeEmail(email);
  const inserted = deps.store.suppressions.insert({ id: deps.newId(), kind: 'email', valueHash: hashValue(normalized), reason, createdAt: nowIso(deps) });
  const contact = deps.store.contacts.findByEmail(normalized);
  if (contact && !contact.doNotContact) deps.store.contacts.update({ ...contact, doNotContact: true, updatedAt: nowIso(deps) });
  const owner = companyId ?? contact?.companyId;
  if (inserted && owner) record(deps, { companyId: owner, contactId: contact?.id, type: 'suppressed', summary: `E-mail suprimido: ${reason}` });
  return inserted;
};

export const suppressEmail = (deps: Deps, email: string, reason: string): boolean => {
  if (!reason.trim()) throw new DomainError('validation', 'Informe --reason');
  return deps.store.transaction(() => suppressEmailInTransaction(deps, email, reason));
};

export const suppressDomain = (deps: Deps, domainOrUrl: string, reason: string): boolean => {
  if (!reason.trim()) throw new DomainError('validation', 'Informe --reason');
  const domain = normalizeDomain(domainOrUrl);
  return deps.store.transaction(() => {
    const inserted = deps.store.suppressions.insert({ id: deps.newId(), kind: 'domain', valueHash: hashValue(domain), reason, createdAt: nowIso(deps) });
    const company = deps.store.companies.findByDomain(domain);
    if (inserted && company) record(deps, { companyId: company.id, type: 'suppressed', summary: `Domínio suprimido: ${reason}` });
    for (const contact of deps.store.contacts.all().filter((item) => item.email && emailDomain(item.email) === domain && !item.doNotContact))
      deps.store.contacts.update({ ...contact, doNotContact: true, updatedAt: nowIso(deps) });
    return inserted;
  });
};
