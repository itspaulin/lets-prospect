import { z } from 'zod';
import { LEAD_STATUSES, type Lead, type LeadQualification, type LeadSignal, type LeadStatus } from '../entities/lead.js';
import { DomainError } from '../errors.js';
import type { PageFetcher } from '../ports/pages.js';
import type { PlaceSource } from '../ports/places.js';
import type { Deps } from '../ports/runtime.js';
import { normalizeDomain } from '../rules/normalize.js';
import { quoteAppearsIn, readsAsSentence } from '../rules/quote.js';
import { normalizeBrazilPhone } from '../rules/phone.js';
import { extractWhatsapp, pickWhatsapp, type WhatsappFound } from '../rules/whatsapp.js';
import { nowIso, parseInput, today } from './shared.js';

export const DEFAULT_LEAD_SEGMENT = 'imobiliária';

const places = (deps: Deps): PlaceSource => {
  if (!deps.places) throw new DomainError('requirement_missing', 'Busca de leads não configurada: defina GOOGLE_PLACES_API_KEY no .env.');
  return deps.places;
};

const discoverSchema = z.object({
  city: z.string().trim().min(1),
  state: z.string().trim().length(2).optional(),
  // A neighbourhood or district inside the city, to reach places a city-wide search (60 at most) leaves out.
  area: z.string().trim().min(1).optional(),
  segment: z.string().trim().min(1).default(DEFAULT_LEAD_SEGMENT),
  limit: z.number().int().min(1).max(60).default(20),
  dryRun: z.boolean().default(false),
});

export type DiscoverLeadsInput = z.input<typeof discoverSchema>;
export type DiscoverLeadsReport = {
  imported: { name: string; phone: string; kind: Lead['phoneKind'] }[];
  alreadyKnown: string[];
  noPhone: string[];
  invalidPhone: string[];
};

// Companies enter as "identified". Running the same search twice is safe: a place or a phone already in the
// base is skipped. Landlines are kept (some agencies answer WhatsApp on them) but flagged, so the send step can skip them.
export const searchText = (segment: string, place: { city: string; state?: string; area?: string }): string =>
  `${segment} em ${[place.area, place.city, place.state].filter(Boolean).join(', ')}`;

export const discoverLeads = async (deps: Deps, input: DiscoverLeadsInput): Promise<DiscoverLeadsReport> => {
  const data = parseInput(discoverSchema, input);
  const source = places(deps);
  const state = data.state?.toUpperCase();
  const text = searchText(data.segment, { city: data.city, state, area: data.area });
  const found = await source.search({ text, limit: data.limit });
  const report: DiscoverLeadsReport = { imported: [], alreadyKnown: [], noPhone: [], invalidPhone: [] };
  for (const place of found) {
    if (!place.phone) {
      report.noPhone.push(place.name);
      continue;
    }
    const phone = normalizeBrazilPhone(place.phone);
    if (!phone) {
      report.invalidPhone.push(`${place.name} (${place.phone})`);
      continue;
    }
    if (deps.store.leads.findByPlaceId(place.placeId) || deps.store.leads.findByPhone(phone.e164)) {
      report.alreadyKnown.push(place.name);
      continue;
    }
    if (!data.dryRun) {
      const now = nowIso(deps);
      deps.store.leads.insert({
        id: deps.newId(),
        placeId: place.placeId,
        name: place.name,
        phone: phone.e164,
        phoneKind: phone.kind,
        website: place.website,
        address: place.address,
        city: data.city,
        state,
        rating: place.rating,
        reviewCount: place.reviewCount,
        segment: data.segment,
        status: 'identified',
        source: `${source.name}, ${today(deps)}`,
        createdAt: now,
        updatedAt: now,
      });
    }
    report.imported.push({ name: place.name, phone: phone.e164, kind: phone.kind });
  }
  // One request returns up to 20 places; the count feeds the monthly cap on Google requests.
  if (!data.dryRun) deps.store.leadSearches.insert({ id: deps.newId(), query: text, ranAt: nowIso(deps), found: found.length, imported: report.imported.length, requests: Math.max(1, Math.ceil(found.length / 20)) });
  return report;
};

export const listLeads = (deps: Deps, filter: { statuses?: string[]; city?: string } = {}): Lead[] => {
  const invalid = filter.statuses?.find((status) => !(LEAD_STATUSES as readonly string[]).includes(status));
  if (invalid) throw new DomainError('validation', `Status inválido: ${invalid}. Use: ${LEAD_STATUSES.join(', ')}`);
  return deps.store.leads.list({ statuses: filter.statuses as LeadStatus[] | undefined, city: filter.city });
};

const pageFetcher = (deps: Deps): PageFetcher => {
  if (!deps.pages) throw new DomainError('requirement_missing', 'Leitura de sites não configurada.');
  return deps.pages;
};

// Where a company puts its WhatsApp button: the home page, the contact page, the "talk to us" page.
const CONTACT_PATH = /(contato|contact|fale|atendimento|whatsapp)/i;
const MAX_ENRICH_PAGES = 3;

const enrichSchema = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  // Also look again at leads that were enriched before and ended without a WhatsApp number.
  retry: z.boolean().default(false),
});

export type EnrichLeadsInput = z.input<typeof enrichSchema>;
export type EnrichLeadsReport = {
  found: { name: string; whatsapp: string; source: string }[];
  fromListing: { name: string; whatsapp: string }[];
  notFound: { name: string; reason: string }[];
};

const needsEnrichment = (lead: Lead, retry: boolean): boolean => lead.status === 'identified' && (!lead.enrichedAt || (retry && !lead.whatsapp));

// The Google listing usually shows a landline; the WhatsApp number is on the company's own site. Read the
// site, take the number the company published, and say which page it came from. A mobile number from the
// listing is the fallback. A failure on one site is recorded on that lead and never stops the run.
// shouldStop is checked before each lead, so a long run can be interrupted without losing what it already did.
export const enrichLeads = async (deps: Deps, input: EnrichLeadsInput = {}, hooks: { shouldStop?: () => boolean } = {}): Promise<EnrichLeadsReport> => {
  const data = parseInput(enrichSchema, input);
  const fetcher = pageFetcher(deps);
  const report: EnrichLeadsReport = { found: [], fromListing: [], notFound: [] };
  const pending = deps.store.leads.list().filter((lead) => needsEnrichment(lead, data.retry)).slice(0, data.limit);
  for (const lead of pending) {
    if (hooks.shouldStop?.()) break;
    const { whatsapp, source, note } = await findWhatsapp(fetcher, lead);
    const updated: Lead = { ...lead, whatsapp, whatsappSource: source, enrichedAt: nowIso(deps), enrichmentNote: whatsapp ? undefined : note, updatedAt: nowIso(deps) };
    deps.store.leads.update(updated);
    if (!whatsapp) report.notFound.push({ name: lead.name, reason: note ?? 'não encontrado' });
    else if (source === LISTING_SOURCE) report.fromListing.push({ name: lead.name, whatsapp });
    else report.found.push({ name: lead.name, whatsapp, source: source! });
  }
  return report;
};

const LISTING_SOURCE = 'cadastro no Google (celular, não confirmado no site)';

const findWhatsapp = async (fetcher: PageFetcher, lead: Lead): Promise<{ whatsapp?: string; source?: string; note?: string }> => {
  const fallback = lead.phoneKind === 'mobile' ? { whatsapp: lead.phone, source: LISTING_SOURCE } : undefined;
  if (!lead.website) return fallback ?? { note: 'sem site e o telefone do Google é fixo' };
  let domain: string;
  try {
    domain = normalizeDomain(lead.website);
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    return fallback ?? { note: 'endereço do site inválido' };
  }
  const read = await fetcher.fetchRaw(domain, { linkPattern: CONTACT_PATH, maxPages: MAX_ENRICH_PAGES });
  for (const page of read.pages) {
    const found: WhatsappFound | undefined = pickWhatsapp(extractWhatsapp(page.html));
    if (found) return { whatsapp: found.phone.e164, source: page.url };
  }
  return fallback ?? { note: read.problem ?? 'o site não publica número de WhatsApp' };
};

// Leads still worth contacting that nobody has messaged: not judged yet or judged a fit, and not known to lack WhatsApp.
export const countCandidates = (deps: Deps): number =>
  deps.store.leads
    .list({ statuses: ['identified'] })
    .filter((lead) => !deps.store.waMessages.findByLead(lead.id) && lead.qualification?.verdict !== 'not_a_fit' && (!lead.enrichedAt || lead.whatsapp)).length;

export type AutoDiscoverReport = { skipped?: string; searches: { query: string; imported: number }[] };

// Keeps the pool full without anyone launching a search: when fewer candidates than the minimum are waiting, it
// searches the next place in the list that was not searched recently, within the monthly cap on Google requests.
export const discoverNextLeads = async (deps: Deps): Promise<AutoDiscoverReport> => {
  const config = deps.leadsConfig;
  const { discovery } = config;
  if (!deps.places) return { skipped: 'Google Places não configurado', searches: [] };
  if (discovery.targets.length === 0) return { skipped: 'nenhum lugar em config/leads.json', searches: [] };
  const candidates = countCandidates(deps);
  if (candidates >= discovery.minCandidates) return { skipped: `já há ${candidates} candidatos (mínimo ${discovery.minCandidates})`, searches: [] };
  const now = deps.clock.now();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const perSearch = Math.ceil(discovery.perSearchLimit / 20);
  const cooldownStart = new Date(now.getTime() - discovery.cooldownDays * 86_400_000).toISOString();
  const report: AutoDiscoverReport = { searches: [] };
  let spent = deps.store.leadSearches.requestsSince(monthStart);
  for (const target of discovery.targets) {
    if (report.searches.length >= discovery.maxSearchesPerRun) break;
    const query = searchText(config.segment, target);
    const last = deps.store.leadSearches.lastRan(query);
    if (last && last >= cooldownStart) continue;
    if (spent + perSearch > discovery.maxRequestsPerMonth) {
      report.skipped = `teto de ${discovery.maxRequestsPerMonth} requisições do Google no mês atingido`;
      break;
    }
    const result = await discoverLeads(deps, { ...target, segment: config.segment, limit: discovery.perSearchLimit });
    spent += perSearch;
    report.searches.push({ query, imported: result.imported.length });
  }
  if (report.searches.length === 0 && !report.skipped) report.skipped = 'todos os lugares da lista foram pesquisados há pouco';
  return report;
};

export type QualifyLeadsReport = { results: { name: string; outcome: 'fit' | 'not_a_fit' | 'unclear' | 'unreachable'; reason: string }[] };

const verifySignals = (signals: Omit<LeadSignal, 'verified'>[], pages: { url: string; text: string }[]): LeadSignal[] =>
  signals.map((signal) => {
    const page = pages.find((item) => item.url === signal.pageUrl);
    return { ...signal, verified: !!page && quoteAppearsIn(signal.quote, page.text) && readsAsSentence(signal.quote) };
  });

// The AI proposes a verdict and the code checks it: "fit" needs a verified quote showing what the business does,
// "not_a_fit" needs a verified quote against it. Anything else is "unclear" and nobody is contacted. Only leads
// that have a WhatsApp number are judged, so the model is never paid for a business that could not be contacted.
export const qualifyLeads = async (deps: Deps, input: { limit?: number } = {}, hooks: { shouldStop?: () => boolean } = {}): Promise<QualifyLeadsReport> => {
  const limit = parseInput(z.object({ limit: z.number().int().min(1).max(200).default(50) }), input).limit;
  const qualifier = deps.leadQualifier;
  const fetcher = deps.qualifying?.fetcher;
  if (!qualifier || !fetcher) throw new DomainError('requirement_missing', 'Qualificação por IA não configurada: defina AWS_BEARER_TOKEN_BEDROCK no .env.');
  const report: QualifyLeadsReport = { results: [] };
  const pending = deps.store.leads.list({ statuses: ['identified'] }).filter((lead) => lead.whatsapp && !lead.qualifiedAt).slice(0, limit);
  for (const lead of pending) {
    if (hooks.shouldStop?.()) break;
    const save = (qualification: LeadQualification, judged: boolean) =>
      deps.store.leads.update({ ...lead, qualification, qualifiedAt: judged ? nowIso(deps) : undefined, updatedAt: nowIso(deps) });
    const fail = (reason: string, judged: boolean) => {
      save({ verdict: 'unclear', reason, signals: [], model: qualifier.name }, judged);
      report.results.push({ name: lead.name, outcome: judged ? 'unclear' : 'unreachable', reason });
    };
    if (!lead.website) {
      fail('sem site para avaliar', true);
      continue;
    }
    let domain: string;
    try {
      domain = normalizeDomain(lead.website);
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      fail('endereço do site inválido', true);
      continue;
    }
    const site = await fetcher.fetchSite(domain);
    if (site.pages.length === 0) {
      fail(`site não lido: ${site.problem ?? 'ilegível'}`, false);
      continue;
    }
    const verdict = await qualifier.qualify({ lead: { name: lead.name, city: lead.city, state: lead.state }, profile: deps.leadsConfig.profile, pages: site.pages });
    const signals = verifySignals(verdict.signals, site.pages);
    const has = (kind: LeadSignal['kind']) => signals.some((signal) => signal.kind === kind && signal.verified);
    const final = verdict.verdict === 'fit' && has('activity') ? 'fit' : verdict.verdict === 'not_a_fit' && has('contradiction') ? 'not_a_fit' : 'unclear';
    const reason = final === 'unclear' && verdict.verdict !== 'unclear' ? `${verdict.reason} (sem citação verificável no site; precisa de revisão)` : verdict.reason;
    save({ verdict: final, reason, signals, model: qualifier.name }, true);
    report.results.push({ name: lead.name, outcome: final, reason });
  }
  return report;
};
