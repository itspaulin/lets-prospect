import type { Company } from '../entities/company.js';
import type { Contact } from '../entities/contact.js';
import type { Campaign, Message } from '../entities/outreach.js';
import { DomainError } from '../errors.js';
import type { Deps } from '../ports/runtime.js';
import { decisionMakerScore } from '../rules/decision-maker.js';
import { addBusinessDays } from '../rules/business-days.js';
import { emailDomain } from '../rules/normalize.js';
import { hashValue } from '../rules/render.js';

export const resolveCampaign = (deps: Deps, ref: string): Campaign => {
  const campaign = deps.store.campaigns.findByName(ref) ?? deps.store.campaigns.findById(ref);
  if (!campaign) throw new DomainError('not_found', `Campanha não encontrada: ${ref}`);
  return campaign;
};

export const isSuppressed = (deps: Deps, email: string): boolean =>
  deps.store.suppressions.has('email', hashValue(email)) || deps.store.suppressions.has('domain', hashValue(emailDomain(email)));

export const decisionMakerRoles = (deps: Deps): string[] =>
  deps.scoring.criteria.flatMap((criterion) => (criterion.type === 'decision_maker_contact' ? criterion.roles : []));

export const contactBlockReason = (deps: Deps, contact: Contact): string | undefined => {
  if (!contact.email) return 'sem e-mail';
  if (contact.doNotContact) return 'marcado para não contatar';
  if (contact.verificationStatus === 'invalid') return 'e-mail inválido';
  if (isSuppressed(deps, contact.email)) return 'na lista de supressão';
  return undefined;
};

// Most senior role first (CEO/founder, CTO, other C-levels, heads, directors), anyone else only as a last resort;
// a verified address breaks ties. One person per company keeps the approach personal.
export const pickContact = (deps: Deps, company: Company): Contact | undefined => {
  const rank = (contact: Contact) => decisionMakerScore(contact.role) * 2 + (contact.verificationStatus === 'verified' ? 1 : 0);
  return deps.store.contacts
    .listByCompany(company.id)
    .filter((contact) => !contactBlockReason(deps, contact))
    .sort((a, b) => rank(b) - rank(a))[0];
};

export const openCampaignFor = (deps: Deps, companyId: string): Campaign | undefined =>
  deps.store.targets
    .listByCompany(companyId)
    .map((target) => deps.store.campaigns.findById(target.campaignId)!)
    .find((campaign) => campaign.status !== 'closed');

export const listReadyForContact = (deps: Deps): { company: Company; contact: Contact }[] =>
  deps.store.companies
    .list({ statuses: ['qualified'] })
    .flatMap((company) => {
      const contact = pickContact(deps, company);
      return contact && !openCampaignFor(deps, company.id) ? [{ company, contact }] : [];
    });

export const firstName = (contact: Contact): string => contact.name.split(/\s+/)[0] ?? contact.name;

// Follow-up N is due `intervalBusinessDays[N-1]` business days after the FIRST e-mail (3, 5, 7), not after the
// previous one. A late send never makes the next follow-up fall due on the same day as the one before it.
export const followUpDueAt = (deps: Deps, previous: Message & { sentAt: string }): string => {
  const { intervalBusinessDays } = deps.sending.followUp;
  const first = deps.store.messages.find(previous.campaignId, previous.contactId, 0);
  const planned = addBusinessDays(first?.sentAt ?? previous.sentAt, intervalBusinessDays[previous.step] ?? intervalBusinessDays.at(-1) ?? 5);
  const earliest = addBusinessDays(previous.sentAt, 1);
  return planned > earliest ? planned : earliest;
};
