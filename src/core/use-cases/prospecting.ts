import { z } from 'zod';
import { DomainError } from '../errors.js';
import type { ProspectingPorts } from '../ports/prospecting.js';
import type { Deps } from '../ports/runtime.js';
import { decisionMakerScore, isDecisionMaker } from '../rules/decision-maker.js';
import { normalizeCountry, normalizeDomain, normalizeEmail } from '../rules/normalize.js';
import { hashValue } from '../rules/render.js';
import { addCompany } from './companies.js';
import type { Company } from '../entities/company.js';
import { pendingQualification, qualifyCompany, type QualifyResult } from './ai-qualification.js';
import { addContact } from './contacts.js';
import { nowIso, parseInput, resolveCompany, today } from './shared.js';

const ports = (deps: Deps): ProspectingPorts => {
  if (!deps.prospecting) throw new DomainError('requirement_missing', 'Prospecção automática não configurada: defina HUNTER_API_KEY no .env.');
  return deps.prospecting;
};

// What a software house says about itself. Used when the search names no keywords of its own.
// Brazilian sites describe themselves in Portuguese, and the targets include IT consultancies and outsourcing firms.
export const BR_KEYWORDS = ['software house', 'desenvolvimento de software', 'fábrica de software', 'desenvolvimento de aplicativos', 'consultoria de TI', 'alocação de profissionais de TI', 'outsourcing de TI'];

export const defaultKeywords = (country: string): string[] => (country === 'BR' ? BR_KEYWORDS : DEFAULT_KEYWORDS);

export const DEFAULT_KEYWORDS = ['software development agency', 'custom software development', 'web development agency', 'app development agency'];

const discoverSchema = z.object({
  country: z.string().trim().min(1),
  state: z.string().trim().min(1).optional(),
  city: z.string().trim().min(1).optional(),
  headcount: z.array(z.string()).optional(),
  keywords: z.array(z.string().trim().min(1)).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  dryRun: z.boolean().default(false),
});

export type DiscoverInput = z.input<typeof discoverSchema>;
export type DiscoverReport = {
  imported: { domain: string; name: string }[];
  alreadyKnown: string[];
  suppressed: string[];
  noContacts: string[];
  failed: { domain: string; error: string }[];
};

// Free step: companies enter as "identified" and nothing is spent. Domains already in the database, on the
// suppression list or without any known personal e-mail are skipped, so running the same search twice is safe.
export const discoverCompanies = async (deps: Deps, input: DiscoverInput): Promise<DiscoverReport> => {
  const data = parseInput(discoverSchema, input);
  const { leads } = ports(deps);
  const country = normalizeCountry(data.country);
  const state = data.state?.toUpperCase();
  if (data.city && country === 'US' && !state) throw new DomainError('validation', 'Nos EUA a cidade exige o estado: use --state NY junto com --city "New York"');
  const keywords = data.keywords?.length ? data.keywords : defaultKeywords(country);
  const found = await leads.discover({ country, state, city: data.city, headcount: data.headcount, keywords, limit: data.limit });
  const region = [data.city, state].filter(Boolean).join(', ') || undefined;
  const report: DiscoverReport = { imported: [], alreadyKnown: [], suppressed: [], noContacts: [], failed: [] };
  for (const item of found) {
    try {
      const domain = normalizeDomain(item.domain);
      if (deps.store.suppressions.has('domain', hashValue(domain))) report.suppressed.push(domain);
      else if (deps.store.companies.findByDomain(domain)) report.alreadyKnown.push(domain);
      // The count is free; a company with no named people would only burn a credit later.
      else if (item.personalEmails === 0) report.noContacts.push(domain);
      else {
        if (!data.dryRun) addCompany(deps, { name: item.name, website: domain, country, region, source: `${leads.name} discover, ${today(deps)}` });
        report.imported.push({ domain, name: item.name });
      }
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      report.failed.push({ domain: item.domain, error: error.message });
    }
  }
  return report;
};

const SEARCH_SIZE = 10;

const contactsSchema = z.object({
  maxCredits: z.number().int().min(1).default(5),
  perCompany: z.number().int().min(1).max(5).default(2),
});

export type FindContactsInput = z.input<typeof contactsSchema>;
export type ContactsEntry = { domain: string; added: string[]; skipped: string[]; note?: string };
export type FindContactsReport = {
  spentCredits: number;
  stoppedByCap: boolean;
  companies: ContactsEntry[];
};

// Lets a screen follow a long run and stop it between companies, never in the middle of one.
export type ProspectEvent =
  | { type: 'discovered'; report: DiscoverReport }
  | { type: 'planned'; total: number }
  | { type: 'qualified'; result: QualifyResult }
  | { type: 'contacts'; entry: ContactsEntry; spentCredits: number };
export type ProspectHooks = { onEvent?: (event: ProspectEvent) => void; shouldStop?: () => boolean };

// Paid step: one Hunter search costs a credit when it returns something. The balance is read before and
// after every search, so the cap holds even if the provider's billing rule differs from what we assumed.
export const findContacts = async (deps: Deps, refs: string[], input: FindContactsInput = {}, hooks: ProspectHooks = {}): Promise<FindContactsReport> => {
  const data = parseInput(contactsSchema, input);
  const { finder } = ports(deps);
  const start = await finder.creditsRemaining();
  if (start < 1) throw new DomainError('requirement_missing', 'Sem créditos no Hunter neste período.');
  const report: FindContactsReport = { spentCredits: 0, stoppedByCap: false, companies: [] };
  let balance = start;

  for (const ref of refs) {
    if (hooks.shouldStop?.()) break;
    if (report.spentCredits >= data.maxCredits || balance < 1) {
      report.stoppedByCap = true;
      break;
    }
    const company = resolveCompany(deps, ref);
    const entry: ContactsEntry = { domain: company.domain, added: [], skipped: [] };
    report.companies.push(entry);
    await searchCompany(deps, company, entry, data.perCompany);
    balance = await finder.creditsRemaining();
    report.spentCredits = start - balance;
    hooks.onEvent?.({ type: 'contacts', entry, spentCredits: report.spentCredits });
  }
  return report;
};

const searchCompany = async (deps: Deps, company: Company, entry: ContactsEntry, perCompany: number): Promise<void> => {
  const { finder } = ports(deps);
  // Erased or blocked contacts do not count: they would otherwise keep the company off the search forever.
  if (deps.store.contacts.listByCompany(company.id).some((contact) => contact.email && !contact.doNotContact)) {
    entry.note = 'já tem contato; não gastou crédito';
    return;
  }
  // A search costs the same whether it returns 2 or 10 addresses, so ask for many and rank by role.
  const all = await finder.findDecisionMakers(company.domain, { limit: SEARCH_SIZE });
  const found = all
    .filter((person) => isDecisionMaker(person.role))
    .sort((a, b) => decisionMakerScore(b.role) - decisionMakerScore(a.role));
  if (found.length === 0) entry.note = all.length ? `${all.length} e-mails, nenhum cargo de decisão` : 'nenhum e-mail encontrado';
  for (const person of found) {
    if (entry.added.length >= perCompany) break;
    if (!person.name.trim()) {
      entry.skipped.push(`${person.email}: sem nome`);
      continue;
    }
    if (person.verification === 'invalid' || deps.store.suppressions.has('email', hashValue(normalizeEmail(person.email)))) {
      entry.skipped.push(`${person.email}: ${person.verification === 'invalid' ? 'inválido' : 'suprimido'}`);
      continue;
    }
    try {
      addContact(deps, company.id, {
        name: person.name,
        role: person.role,
        email: person.email,
        source: person.sources[0] ?? `${finder.name} domain search, ${nowIso(deps).slice(0, 10)}`,
        verificationStatus: person.verification === 'valid' ? 'verified' : 'unverified',
      });
      entry.added.push(`${person.name}${person.role ? `, ${person.role}` : ''} <${person.email}>`);
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      entry.skipped.push(`${person.email}: ${error.message}`);
    }
  }
};

export const creditsRemaining = (deps: Deps): Promise<number> => ports(deps).finder.creditsRemaining();

const funnelSchema = contactsSchema.extend({ contacts: z.boolean().default(true) });
export type FunnelInput = z.input<typeof funnelSchema>;
export type RunInput = DiscoverInput & FunnelInput;
export type RunReport = {
  discovered?: DiscoverReport;
  qualified: QualifyResult[];
  contacts: FindContactsReport | undefined;
};

// AI first, paid lookup only for the companies it passed. A failure on one company is reported and the
// rest go on, so one broken site never ends a run.
const qualifyThenFindContacts = async (deps: Deps, domains: string[], input: FunnelInput, hooks: ProspectHooks): Promise<RunReport> => {
  const data = parseInput(funnelSchema, input);
  hooks.onEvent?.({ type: 'planned', total: domains.length });
  const qualified: QualifyResult[] = [];
  for (const domain of domains) {
    if (hooks.shouldStop?.()) break;
    let result: QualifyResult;
    try {
      result = await qualifyCompany(deps, domain);
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      result = { domain, outcome: 'unclear', reason: error.message };
    }
    qualified.push(result);
    hooks.onEvent?.({ type: 'qualified', result });
  }
  const passed = qualified.filter((item) => item.outcome === 'qualified').map((item) => item.domain);
  const contacts = data.contacts && passed.length && !hooks.shouldStop?.() ? await findContacts(deps, passed, data, hooks) : undefined;
  return { qualified, contacts };
};

// The whole funnel, cheapest step first: free discovery, then AI on the site text, then paid e-mail
// lookup only for companies that passed. Safe to repeat: known companies and contacts are skipped.
export const runProspecting = async (deps: Deps, input: RunInput, hooks: ProspectHooks = {}): Promise<RunReport> => {
  const { maxCredits, perCompany, contacts, ...search } = input;
  const discovered = await discoverCompanies(deps, search);
  hooks.onEvent?.({ type: 'discovered', report: discovered });
  if (search.dryRun) return { discovered, qualified: [], contacts: undefined };
  const rest = await qualifyThenFindContacts(deps, discovered.imported.map((item) => item.domain), { maxCredits, perCompany, contacts }, hooks);
  return { discovered, ...rest };
};

// Companies already in the base that the AI never judged, including sites that failed to load before.
// With domains, only those (a retry picked on screen); anything no longer identified is left alone.
export const runPending = async (deps: Deps, input: FunnelInput & { limit?: number; domains?: string[] }, hooks: ProspectHooks = {}): Promise<RunReport> => {
  const { limit, domains, ...funnel } = input;
  const pending = pendingQualification(deps).map((company) => company.domain);
  const chosen = domains ? domains.map((domain) => resolveCompany(deps, domain)).filter((company) => company.status === 'identified').map((company) => company.domain) : pending;
  return qualifyThenFindContacts(deps, limit === undefined ? chosen : chosen.slice(0, limit), funnel, hooks);
};
