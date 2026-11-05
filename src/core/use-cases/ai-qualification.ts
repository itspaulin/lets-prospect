import type { Company } from '../entities/company.js';
import { DomainError } from '../errors.js';
import type { Deps } from '../ports/runtime.js';
import type { QualifyingPorts, SitePage } from '../ports/qualification.js';
import { mentionsWord, quoteAppearsIn, readsAsSentence } from '../rules/quote.js';
import { TARGET_SEGMENTS } from '../rules/segments.js';
import { normalizeStack } from '../rules/technology.js';
import { addCompanyNote, changeCompanyStatus, updateCompany } from './companies.js';
import { addEvidence } from './evidences.js';
import { resolveCompany } from './shared.js';

const ports = (deps: Deps): QualifyingPorts => {
  if (!deps.qualifying) throw new DomainError('requirement_missing', 'Qualificação por IA não configurada: defina AWS_BEARER_TOKEN_BEDROCK no .env.');
  return deps.qualifying;
};

export type QualifyOutcome = 'qualified' | 'disqualified' | 'unclear' | 'unreachable' | 'skipped';
export type QualifyResult = { domain: string; outcome: QualifyOutcome; reason: string };

// The whole stack is kept, because the score is the share of it that matches mine. Fields and buzzwords
// are not tools and would only shrink that share, so they never get in.
const NOT_A_TECHNOLOGY = /^(ai|artificial intelligence|machine learning|ml|deep learning|natural language processing|nlp|generative ai|iot|internet of things|blockchain|web3|cloud|cloud computing|cloud solutions|mobile|web|full stack|full-stack|devops|ux|ui|ui\/ux|saas|big data|data science|analytics|e-commerce|ecommerce|game development|mobile application development|augmented reality|virtual reality|ar|vr|cms|crm|seo)$/i;

const wantedTechnologies = (deps: Deps): string[] =>
  deps.scoring.criteria.flatMap((criterion) => (criterion.type === 'technology_overlap' ? criterion.technologies : []));

// How the company's kind is shown and filtered later.
const SEGMENT_LABEL = { software_house: TARGET_SEGMENTS[0], it_consultancy: TARGET_SEGMENTS[1] } as const;

const AI_NOTE = 'Qualificação por IA';
const UNREACHABLE_NOTE = `${AI_NOTE}, site não lido`;
// Verdict notes always name the model in parentheses; that is what takes a company out of the queue.
const VERDICT_NOTE = `${AI_NOTE} (`;

// Identified companies the AI never judged. A site that could not be read stays pending: retrying it is
// free (the model is never called) and many failures are a slow server. A verdict is never paid twice.
export const pendingQualification = (deps: Deps, limit?: number): Company[] => {
  const pending = deps.store.companies
    .list({ statuses: ['identified'] })
    .filter((company) => !deps.store.interactions.listByCompany(company.id).some((item) => item.type === 'note_added' && item.summary.startsWith(VERDICT_NOTE)));
  return limit === undefined ? pending : pending.slice(0, limit);
};

// unclear: the AI read the site but no quote checked out. The rest are sites it could not read:
// javascript (empty shell, retrying will not help until pages are rendered), blocked (the site refuses
// robots) and failed (timeouts, network, server errors: worth retrying).
export type ReviewKind = 'unclear' | 'javascript' | 'blocked' | 'failed';
export type ReviewItem = { company: Company; kind: ReviewKind; note: string; at: string };

const reviewKind = (summary: string): ReviewKind => {
  if (summary.startsWith(VERDICT_NOTE)) return 'unclear';
  if (/JavaScript/.test(summary)) return 'javascript';
  if (/bloqueado para robôs|robots\.txt/.test(summary)) return 'blocked';
  return 'failed';
};

// Identified companies the AI looked at but could not settle. They need a person, and the latest AI note
// says why.
export const aiReviewQueue = (deps: Deps): ReviewItem[] =>
  deps.store.companies.list({ statuses: ['identified'] }).flatMap((company) => {
    const last = deps.store.interactions
      .listByCompany(company.id)
      .filter((item) => item.type === 'note_added' && item.summary.startsWith(AI_NOTE))
      .at(-1);
    if (!last) return [];
    return [{ company, kind: reviewKind(last.summary), note: last.summary.replace(/^Qualificação por IA(?: \([^)]*\)|, site não lido)?: /, ''), at: last.occurredAt }];
  });

const pageFor = (pages: SitePage[], url: string): SitePage | undefined => pages.find((page) => page.url === url);

// A finding is "verified" only when its quote is really on the page it points to and reads as a sentence. The model proposes,
// the code checks: an invented quote becomes a hypothesis and cannot qualify a company by itself.
export const qualifyCompany = async (deps: Deps, ref: string): Promise<QualifyResult> => {
  const { fetcher, qualifier } = ports(deps);
  const company = resolveCompany(deps, ref);
  const result = (outcome: QualifyOutcome, reason: string): QualifyResult => ({ domain: company.domain, outcome, reason });
  if (company.status !== 'identified') return result('skipped', `já está em ${company.status}`);

  const { pages, problem } = await fetcher.fetchSite(company.domain);
  if (pages.length === 0) {
    const why = problem ?? 'site ilegível';
    addCompanyNote(deps, company.id, `${UNREACHABLE_NOTE}: ${why}. Nada foi decidido.`);
    return result('unreachable', why);
  }

  const verdict = await qualifier.qualify({ company: { name: company.name, domain: company.domain, country: company.country }, pages });
  const allText = pages.map((page) => page.text).join('\n');
  let verifiedSupport = false;
  let verifiedContradiction = false;

  for (const finding of verdict.findings) {
    const page = pageFor(pages, finding.pageUrl);
    // Technology quotes may be lists; everything else must be a sentence, not a menu or a heading.
    const verified = !!page && quoteAppearsIn(finding.quote, page.text) && (finding.kind === 'technology' || readsAsSentence(finding.quote));
    if (verified && finding.kind === 'business_model') {
      if (finding.stance === 'supports') verifiedSupport = true;
      else verifiedContradiction = true;
    }
    addEvidence(deps, company.id, {
      kind: finding.kind,
      claim: `${finding.claim} — "${finding.quote}"`,
      certainty: verified ? 'verified' : 'hypothesis',
      stance: finding.stance,
      source: verified ? finding.pageUrl : undefined,
    });
  }

  const technologies = verdict.technologies.filter((name) => !NOT_A_TECHNOLOGY.test(name.trim()) && mentionsWord(name, allText));
  if (technologies.length) updateCompany(deps, company.id, { technologies: normalizeStack([...company.technologies, ...technologies], wantedTechnologies(deps)) });
  addCompanyNote(deps, company.id, `${VERDICT_NOTE}${qualifier.name}): ${verdict.verdict}. ${verdict.reason}`);

  if (verdict.verdict === 'software_house' && verifiedSupport) {
    if (verdict.segment) updateCompany(deps, company.id, { segment: SEGMENT_LABEL[verdict.segment] });
    changeCompanyStatus(deps, company.id, 'qualified');
    return result('qualified', verdict.reason);
  }
  if (verdict.verdict === 'not_a_fit' && verifiedContradiction) {
    changeCompanyStatus(deps, company.id, 'disqualified', { reason: `IA: ${verdict.reason}` });
    return result('disqualified', verdict.reason);
  }
  const why = verdict.verdict === 'unclear' ? verdict.reason : 'sem citação verificável no site; precisa de revisão humana';
  return result('unclear', why);
};

// Reads the site again only for its stack: no evidence, no status change. For companies judged before the
// whole stack was kept.
export const refreshTechnologies = async (deps: Deps, ref: string): Promise<{ domain: string; technologies: string[]; problem?: string }> => {
  const { fetcher, qualifier } = ports(deps);
  const company = resolveCompany(deps, ref);
  const { pages, problem } = await fetcher.fetchSite(company.domain);
  if (pages.length === 0) return { domain: company.domain, technologies: company.technologies, problem: problem ?? 'site ilegível' };
  const verdict = await qualifier.qualify({ company: { name: company.name, domain: company.domain, country: company.country }, pages });
  const allText = pages.map((page) => page.text).join('\n');
  const found = verdict.technologies.filter((name) => !NOT_A_TECHNOLOGY.test(name.trim()) && mentionsWord(name, allText));
  const technologies = normalizeStack([...company.technologies, ...found], wantedTechnologies(deps));
  if (technologies.length !== company.technologies.length) updateCompany(deps, company.id, { technologies });
  return { domain: company.domain, technologies };
};
