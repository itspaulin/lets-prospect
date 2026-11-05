import { z } from 'zod';
import { type Company, type CompanyStatus, PRIORITIES } from '../entities/company.js';
import type { Contact } from '../entities/contact.js';
import type { Evidence } from '../entities/evidence.js';
import type { Interaction } from '../entities/interaction.js';
import { DomainError } from '../errors.js';
import type { Deps } from '../ports/runtime.js';
import type { CompanyFilter, CompanyListItem } from '../ports/store.js';
import { assertTransition, type TransitionOptions } from '../rules/company-status.js';
import { belongsToDomain, normalizeCompanyName, normalizeCountry, normalizeDomain, normalizeTechnologies } from '../rules/normalize.js';
import { computeQualification, saveQualification } from './qualification.js';
import { applyPatch, isoDate, nowIso, parseInput, record, resolveCompany, type Patch } from './shared.js';

const text = z.string().trim().min(1);

const fields = {
  name: text,
  website: text,
  country: text,
  region: text,
  segment: text,
  employeeCount: z.number().int().positive(),
  services: text,
  technologies: z.array(z.string()),
  source: text,
  lastVerifiedAt: isoDate,
  priority: z.enum(PRIORITIES),
  notes: text,
};

const addSchema = z.object({
  ...fields,
  region: fields.region.optional(),
  segment: fields.segment.optional(),
  employeeCount: fields.employeeCount.optional(),
  services: fields.services.optional(),
  technologies: fields.technologies.default([]),
  source: fields.source.optional(),
  lastVerifiedAt: fields.lastVerifiedAt.optional(),
  priority: fields.priority.optional(),
  notes: fields.notes.optional(),
});

const nullableOptional = <T extends z.ZodType>(schema: T) => schema.nullable().optional();
const updateSchema = z.object({
  name: fields.name.optional(),
  website: fields.website.optional(),
  country: fields.country.optional(),
  region: nullableOptional(fields.region),
  segment: nullableOptional(fields.segment),
  employeeCount: nullableOptional(fields.employeeCount),
  services: nullableOptional(fields.services),
  technologies: fields.technologies.optional(),
  source: nullableOptional(fields.source),
  lastVerifiedAt: nullableOptional(fields.lastVerifiedAt),
  priority: nullableOptional(fields.priority),
  notes: nullableOptional(fields.notes),
});

export type AddCompanyInput = z.input<typeof addSchema>;
export type UpdateCompanyInput = z.input<typeof updateSchema>;

const findSimilar = (deps: Deps, company: Pick<Company, 'id' | 'name' | 'domain'>): Company[] => {
  const name = normalizeCompanyName(company.name);
  return deps.store.companies
    .all()
    .filter(
      (other) =>
        other.id !== company.id &&
        ((name.length > 0 && normalizeCompanyName(other.name) === name) ||
          belongsToDomain(other.domain, company.domain) ||
          belongsToDomain(company.domain, other.domain)),
    );
};

export type CompanyCandidateCheck = { domain?: string; error?: string; existing?: Company; similar: Company[] };

// Lets a form warn about duplicates while the user types, using the same rules addCompany enforces.
export const checkCompanyCandidate = (deps: Deps, input: { website?: string; name?: string }): CompanyCandidateCheck => {
  let domain: string | undefined;
  try {
    domain = input.website?.trim() ? normalizeDomain(input.website) : undefined;
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    return { error: error.message, similar: [] };
  }
  const existing = domain ? (deps.store.companies.findByDomain(domain) ?? undefined) : undefined;
  const similar = existing ? [] : findSimilar(deps, { id: '', name: input.name ?? '', domain: domain ?? '' });
  return { domain, existing, similar };
};

export const addCompany = (deps: Deps, input: AddCompanyInput): { company: Company; similar: Company[] } => {
  const data = parseInput(addSchema, input);
  const domain = normalizeDomain(data.website);
  return deps.store.transaction(() => {
    const existing = deps.store.companies.findByDomain(domain);
    if (existing) throw new DomainError('duplicate', `Empresa já cadastrada: ${existing.name} (${existing.domain})`);
    const now = nowIso(deps);
    const company: Company = {
      ...data,
      id: deps.newId(),
      domain,
      country: normalizeCountry(data.country),
      technologies: normalizeTechnologies(data.technologies),
      status: 'identified',
      createdAt: now,
      updatedAt: now,
    };
    deps.store.companies.insert(company);
    record(deps, {
      companyId: company.id,
      type: 'company_created',
      summary: `Empresa cadastrada${company.source ? ` (fonte: ${company.source})` : ' (sem fonte informada)'}`,
      data: { domain, source: company.source },
    });
    return { company, similar: findSimilar(deps, company) };
  });
};

export const updateCompany = (deps: Deps, ref: string, input: UpdateCompanyInput): Company => {
  const data = parseInput(updateSchema, input);
  return deps.store.transaction(() => {
    const current = resolveCompany(deps, ref);
    const patch: Patch<Company> = { ...data };
    if (data.website) {
      const domain = normalizeDomain(data.website);
      const owner = deps.store.companies.findByDomain(domain);
      if (owner && owner.id !== current.id) throw new DomainError('duplicate', `Domínio ${domain} já pertence a ${owner.name}`);
      patch.domain = domain;
    }
    if (data.country) patch.country = normalizeCountry(data.country);
    if (data.technologies) patch.technologies = normalizeTechnologies(data.technologies);

    const { next, changes } = applyPatch(current, patch);
    if (Object.keys(changes).length === 0) return current;
    const updated = { ...next, updatedAt: nowIso(deps) };
    deps.store.companies.update(updated);
    record(deps, { companyId: current.id, type: 'company_updated', summary: `Campos alterados: ${Object.keys(changes).join(', ')}`, data: changes });
    return updated;
  });
};

export const changeCompanyStatus = (deps: Deps, ref: string, to: CompanyStatus, options: TransitionOptions = {}): Company =>
  deps.store.transaction(() => {
    let company = resolveCompany(deps, ref);
    const from = company.status;
    assertTransition(from, to, options);

    if (to === 'qualified') {
      const result = computeQualification(deps, company);
      if (result.missingRequired.length)
        throw new DomainError(
          'requirement_missing',
          `Não pode qualificar sem fato verificado para: ${result.missingRequired.join(', ')}. Registre a evidência com --certainty verified e a fonte.`,
        );
      company = saveQualification(deps, company, result);
    }

    const reason = options.reason?.trim() || undefined;
    const updated: Company = {
      ...company,
      status: to,
      disqualificationReason: to === 'disqualified' ? reason : from === 'disqualified' ? undefined : company.disqualificationReason,
      updatedAt: nowIso(deps),
    };
    deps.store.companies.update(updated);
    record(deps, {
      companyId: company.id,
      type: 'status_changed',
      summary: `${from} -> ${to}${reason ? `: ${reason}` : ''}`,
      data: { from, to, reason, override: options.override || undefined },
    });
    return updated;
  });

export const setNextAction = (deps: Deps, ref: string, input: { at: string | null; note?: string }): Company => {
  const data = parseInput(z.object({ at: isoDate.nullable(), note: text.optional() }), input);
  return deps.store.transaction(() => {
    const company = resolveCompany(deps, ref);
    const updated: Company = {
      ...company,
      nextActionAt: data.at ?? undefined,
      nextActionNote: data.at ? data.note : undefined,
      updatedAt: nowIso(deps),
    };
    deps.store.companies.update(updated);
    record(deps, {
      companyId: company.id,
      type: 'next_action_set',
      summary: data.at ? `Próxima ação em ${data.at}${data.note ? `: ${data.note}` : ''}` : 'Próxima ação removida',
      data: { at: data.at, note: data.note },
    });
    return updated;
  });
};

export const addCompanyNote = (deps: Deps, ref: string, note: string): void => {
  const content = parseInput(text, note);
  deps.store.transaction(() => {
    const company = resolveCompany(deps, ref);
    record(deps, { companyId: company.id, type: 'note_added', summary: content });
  });
};

export const listCompanies = (deps: Deps, filter: CompanyFilter = {}): CompanyListItem[] =>
  deps.store.companies.list({ ...filter, countries: filter.countries?.map(normalizeCountry) });

export const findDuplicateCandidates = (deps: Deps): Company[][] => {
  const groups: Company[][] = [];
  const grouped = new Set<string>();
  for (const company of deps.store.companies.all()) {
    if (grouped.has(company.id)) continue;
    const similar = findSimilar(deps, company).filter((other) => !grouped.has(other.id));
    if (similar.length === 0) continue;
    const group = [company, ...similar];
    group.forEach((member) => grouped.add(member.id));
    groups.push(group);
  }
  return groups;
};

export type CompanyHistory = { company: Company; contacts: Contact[]; evidences: Evidence[]; interactions: Interaction[] };

export const getCompanyHistory = (deps: Deps, ref: string): CompanyHistory => {
  const company = resolveCompany(deps, ref);
  return {
    company,
    contacts: deps.store.contacts.listByCompany(company.id),
    evidences: deps.store.evidences.listByCompany(company.id),
    interactions: deps.store.interactions.listByCompany(company.id),
  };
};
