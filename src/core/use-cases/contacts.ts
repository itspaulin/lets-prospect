import { z } from 'zod';
import type { Company } from '../entities/company.js';
import { type Contact, VERIFICATION_STATUSES } from '../entities/contact.js';
import { DomainError } from '../errors.js';
import type { Deps } from '../ports/runtime.js';
import { belongsToDomain, emailDomain, normalizeEmail } from '../rules/normalize.js';
import { applyPatch, isoDate, nowIso, parseInput, record, resolveCompany, today, type Patch } from './shared.js';

const text = z.string().trim().min(1);

const addSchema = z.object({
  name: text,
  role: text.optional(),
  email: text.optional(),
  source: text.optional(),
  profileUrl: text.optional(),
  identifiedAt: isoDate.optional(),
  verificationStatus: z.enum(VERIFICATION_STATUSES).default('unverified'),
  notes: text.optional(),
});

const updateSchema = z.object({
  name: text.optional(),
  role: text.nullable().optional(),
  email: text.nullable().optional(),
  source: text.nullable().optional(),
  profileUrl: text.nullable().optional(),
  verificationStatus: z.enum(VERIFICATION_STATUSES).optional(),
  doNotContact: z.boolean().optional(),
  notes: text.nullable().optional(),
});

export type AddContactInput = z.input<typeof addSchema>;
export type UpdateContactInput = z.input<typeof updateSchema>;
export type ContactOptions = { allowDomainMismatch?: boolean; reason?: string };

// The e-mail domain check catches contacts attached to the wrong company, the most likely data-entry slip.
const checkEmail = (deps: Deps, company: Company, rawEmail: string, selfId: string | undefined, options: ContactOptions): string => {
  const email = normalizeEmail(rawEmail);
  const owner = deps.store.contacts.findByEmail(email);
  if (owner && owner.id !== selfId) {
    const ownerCompany = deps.store.companies.findById(owner.companyId);
    throw new DomainError('duplicate', `E-mail ${email} já cadastrado para ${owner.name} (${ownerCompany?.domain ?? owner.companyId})`);
  }
  if (!belongsToDomain(emailDomain(email), company.domain) && !options.allowDomainMismatch)
    throw new DomainError('validation', `E-mail ${email} não é do domínio ${company.domain}. Confira a empresa ou use --allow-domain-mismatch`);
  return email;
};

export const resolveContact = (deps: Deps, ref: string): Contact => {
  const contact = ref.includes('@') ? deps.store.contacts.findByEmail(normalizeEmail(ref)) : deps.store.contacts.findById(ref);
  if (!contact) throw new DomainError('not_found', `Contato não encontrado: ${ref}`);
  return contact;
};

export const addContact = (deps: Deps, companyRef: string, input: AddContactInput, options: ContactOptions = {}): Contact => {
  const data = parseInput(addSchema, input);
  if (data.email && !data.source) throw new DomainError('validation', 'Contato com e-mail exige --source (onde o e-mail está publicado)');
  return deps.store.transaction(() => {
    const company = resolveCompany(deps, companyRef);
    const email = data.email ? checkEmail(deps, company, data.email, undefined, options) : undefined;
    const sameName = deps.store.contacts.findByCompanyAndName(company.id, data.name);
    if (sameName) throw new DomainError('duplicate', `${sameName.name} já está cadastrado em ${company.domain}`);
    const now = nowIso(deps);
    const contact: Contact = {
      ...data,
      id: deps.newId(),
      companyId: company.id,
      email,
      identifiedAt: data.identifiedAt ?? today(deps),
      doNotContact: false,
      createdAt: now,
      updatedAt: now,
    };
    deps.store.contacts.insert(contact);
    record(deps, {
      companyId: company.id,
      contactId: contact.id,
      type: 'contact_added',
      summary: `Contato: ${contact.name}${contact.role ? `, ${contact.role}` : ''}${contact.source ? ` (fonte: ${contact.source})` : ''}`,
      data: { source: contact.source, domainMismatch: options.allowDomainMismatch || undefined },
    });
    return contact;
  });
};

export const updateContact = (deps: Deps, ref: string, input: UpdateContactInput, options: ContactOptions = {}): Contact => {
  const data = parseInput(updateSchema, input);
  return deps.store.transaction(() => {
    const current = resolveContact(deps, ref);
    const company = deps.store.companies.findById(current.companyId)!;
    const patch: Patch<Contact> = { ...data };
    if (data.email) patch.email = checkEmail(deps, company, data.email, current.id, options);
    if (data.name) {
      const sameName = deps.store.contacts.findByCompanyAndName(company.id, data.name);
      if (sameName && sameName.id !== current.id) throw new DomainError('duplicate', `${sameName.name} já está cadastrado em ${company.domain}`);
    }
    if (current.doNotContact && data.doNotContact === false && !options.reason?.trim())
      throw new DomainError('validation', 'Remover do_not_contact de um contato exige --reason');

    const { next, changes } = applyPatch(current, patch);
    const finalEmail = next.email;
    if (finalEmail && !next.source) throw new DomainError('validation', 'Contato com e-mail exige fonte');
    if (Object.keys(changes).length === 0) return current;
    const updated = { ...next, updatedAt: nowIso(deps) };
    deps.store.contacts.update(updated);
    record(deps, {
      companyId: company.id,
      contactId: current.id,
      type: 'contact_updated',
      summary: `Contato ${current.name}: ${Object.keys(changes).join(', ')}${options.reason ? ` (${options.reason})` : ''}`,
      data: { changes, reason: options.reason },
    });
    return updated;
  });
};

export const listContacts = (deps: Deps, companyRef: string): Contact[] => deps.store.contacts.listByCompany(resolveCompany(deps, companyRef).id);
