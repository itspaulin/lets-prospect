import { COMPANY_STATUSES, type Company, type CompanyStatus } from '../core/entities/company.js';
import type { Contact } from '../core/entities/contact.js';
import type { Message } from '../core/entities/outreach.js';
import type { Deps } from '../core/ports/runtime.js';
import type { CompanyFilter } from '../core/ports/store.js';
import { allowedTransitions, REASON_REQUIRED } from '../core/rules/company-status.js';
import { approvedTemplate, getCampaign } from '../core/use-cases/campaigns.js';
import { findDuplicateCandidates, getCompanyHistory, listCompanies } from '../core/use-cases/companies.js';
import { followUpBoard, listDueFollowUps } from '../core/use-cases/followups.js';
import { contactBlockReason, decisionMakerRoles, isSuppressed, listReadyForContact, openCampaignFor, pickContact } from '../core/use-cases/outreach-shared.js';
import { isDecisionMaker as isDecisionMakerRole } from '../core/rules/decision-maker.js';
import { footerFor, hashValue, renderMessage } from '../core/rules/render.js';
import { REPLY_EFFECTS } from '../core/rules/replies.js';
import { REPLY_CATEGORIES } from '../core/entities/outreach.js';
import { buildReport } from '../core/use-cases/report.js';
import { today } from '../core/use-cases/shared.js';
import { belongsToDomain, emailDomain, normalizeCompanyName } from '../core/rules/normalize.js';

// Read models shaped for the screens. Writes always go through the use cases; these only combine reads.

export type RuntimeInfo = {
  transport: 'outbox' | 'smtp';
  delivers: boolean;
  databasePath: string;
  scoringPath: string;
  sendingPath: string;
  outboxDir: string;
  smtp: { host?: string; port: number; secure: boolean; user?: string; passwordSet: boolean };
};

const sentToday = (deps: Deps): number => deps.store.attempts.countStartedSince(`${today(deps)}T00:00:00.000Z`);

const stackOf = (deps: Deps): string[] => deps.scoring.criteria.flatMap((criterion) => (criterion.type === 'technology_overlap' ? criterion.technologies : []));

export const metaView = (deps: Deps, info: RuntimeInfo) => ({
  now: deps.clock.now().toISOString(),
  transport: info.transport,
  delivers: info.delivers,
  databasePath: info.databasePath,
  sender: deps.sender,
  stack: stackOf(deps),
  decisionMakerRoles: decisionMakerRoles(deps),
  sending: deps.sending,
  sentToday: sentToday(deps),
  prospecting: { hunter: !!deps.prospecting, ai: !!deps.qualifying },
  whatsapp: { channel: deps.whatsappChannel.name, delivers: deps.whatsappChannel.delivers },
  statuses: COMPANY_STATUSES,
  transitions: Object.fromEntries(COMPANY_STATUSES.map((status) => [status, allowedTransitions(status)])) as Record<CompanyStatus, readonly CompanyStatus[]>,
  reasonRequired: [...REASON_REQUIRED],
  replyCategories: REPLY_CATEGORIES,
  replyEffects: REPLY_EFFECTS,
  badges: {
    drafts: deps.store.messages.list({ statuses: ['draft'] }).length,
    followUps: listDueFollowUps(deps).length,
    conciliation: deps.store.messages.list({ statuses: ['unknown', 'failed'] }).length,
    waDrafts: deps.store.waMessages.list({ statuses: ['draft'] }).length,
    waProblems: deps.store.waMessages.list({ statuses: ['unknown', 'failed'] }).length,
  },
});

const isDecisionMaker = (deps: Deps, contact: Contact): boolean => {
  const roles = decisionMakerRoles(deps);
  return !!contact.role && (isDecisionMakerRole(contact.role) || roles.some((role) => contact.role!.toLowerCase().includes(role)));
};

const contactView = (deps: Deps, company: Company, contact: Contact) => ({
  ...contact,
  decisionMaker: isDecisionMaker(deps, contact),
  suppressed: contact.email ? isSuppressed(deps, contact.email) : false,
  blockReason: contactBlockReason(deps, contact),
  domainMismatch: contact.email ? !belongsToDomain(emailDomain(contact.email), company.domain) : false,
});

const companyRef = (company: Company) => ({ id: company.id, name: company.name, domain: company.domain, country: company.country, status: company.status });

const campaignName = (deps: Deps, id: string): string => deps.store.campaigns.findById(id)?.name ?? id;

const messageSummary = (deps: Deps, message: Message) => {
  const company = deps.store.companies.findById(message.companyId)!;
  const contact = deps.store.contacts.findById(message.contactId);
  const attempts = deps.store.attempts.listByMessage(message.id);
  return {
    id: message.id,
    step: message.step,
    status: message.status,
    personalization: message.personalization,
    toEmail: message.toEmail,
    subject: message.subject,
    error: message.error,
    campaign: campaignName(deps, message.campaignId),
    company: companyRef(company),
    contact: contact ? { id: contact.id, name: contact.name, role: contact.role } : undefined,
    lastAttempt: attempts.at(-1),
  };
};

export const companyListView = (deps: Deps, filter: CompanyFilter) =>
  listCompanies(deps, filter).map((company) => ({ ...company, campaign: openCampaignFor(deps, company.id)?.name }));

export const companyDetailView = (deps: Deps, ref: string) => {
  const history = getCompanyHistory(deps, ref);
  const { company } = history;
  const campaign = openCampaignFor(deps, company.id);
  return {
    ...history,
    interactions: [...history.interactions].reverse(),
    contacts: history.contacts.map((contact) => contactView(deps, company, contact)),
    campaign: campaign ? { id: campaign.id, name: campaign.name, status: campaign.status } : undefined,
    messages: deps.store.messages.list({ companyId: company.id }).map((message) => ({ ...message, campaign: campaignName(deps, message.campaignId) })),
    replies: deps.store.replies.list({ companyId: company.id }),
    allowedTransitions: allowedTransitions(company.status),
  };
};

const duplicateReason = (a: Company, b: Company): string => {
  if (belongsToDomain(a.domain, b.domain) || belongsToDomain(b.domain, a.domain)) return 'subdomínio';
  if (normalizeCompanyName(a.name) === normalizeCompanyName(b.name)) return 'nome parecido';
  return 'semelhante';
};

export const duplicatesView = (deps: Deps) =>
  findDuplicateCandidates(deps).map((group) => ({
    companies: group,
    reasons: group.slice(1).map((other) => ({ id: other.id, reason: duplicateReason(group[0]!, other) })),
  }));

export const todayView = (deps: Deps) => {
  const day = today(deps);
  const campaigns = deps.store.campaigns.all().filter((campaign) => campaign.status !== 'closed');
  const drafts = campaigns.map((campaign) => {
    const messages = deps.store.messages.list({ campaignId: campaign.id, statuses: ['draft'] });
    const pendingTemplates = [0, 1].filter((step) => {
      const latest = deps.store.templates.latest(campaign.id, step);
      return latest && !latest.approvedAt;
    });
    return {
      campaign: { id: campaign.id, name: campaign.name, status: campaign.status },
      evidenceBased: messages.filter((message) => message.personalization === 'evidence_based').length,
      generic: messages.filter((message) => message.personalization === 'generic').length,
      pendingTemplates,
    };
  });
  const monthStart = `${day.slice(0, 8)}01`;
  const month = buildReport(deps, { from: monthStart, to: day });
  const [responseRate, interestRate] = month.rates;
  return {
    today: day,
    unknown: deps.store.messages.list({ statuses: ['unknown'] }).map((message) => messageSummary(deps, message)),
    failed: deps.store.messages.list({ statuses: ['failed'] }).map((message) => messageSummary(deps, message)),
    drafts: drafts.filter((item) => item.evidenceBased + item.generic > 0 || item.pendingTemplates.length > 0),
    approved: deps.store.messages.list({ statuses: ['approved'] }).map((message) => messageSummary(deps, message)),
    followUps: listDueFollowUps(deps).map((item) => ({
      company: companyRef(item.company),
      contact: { id: item.contact.id, name: item.contact.name },
      campaign: campaignName(deps, item.campaignId),
      firstSentAt: item.previous.sentAt,
      dueAt: item.dueAt,
    })),
    nextActions: listCompanies(deps, { nextActionDueBy: day }).map((company) => ({ ...companyRef(company), nextActionAt: company.nextActionAt, nextActionNote: company.nextActionNote })),
    ready: listReadyForContact(deps).map(({ company, contact }) => ({
      company: { ...companyRef(company), qualification: company.qualification },
      contact: { id: contact.id, name: contact.name, role: contact.role },
    })),
    activeCampaigns: campaigns.filter((campaign) => campaign.status === 'active').map((campaign) => campaign.name),
    sending: { sentToday: sentToday(deps), dailyLimit: deps.sending.dailyLimit, minIntervalSeconds: deps.sending.minIntervalSeconds },
    month: {
      from: monthStart,
      reached: responseRate?.denominator ?? 0,
      responded: responseRate?.numerator ?? 0,
      interested: interestRate?.numerator ?? 0,
      opportunities: month.companiesByStatus.opportunity,
      warnings: month.warnings,
    },
  };
};

// ---------------------------------------------------------------- Campanhas

const campaignMetrics = (deps: Deps, campaignId: string) => {
  const report = buildReport(deps, { campaignRef: campaignId });
  const messages = deps.store.messages.list({ campaignId });
  const count = (status: Message['status']) => messages.filter((message) => message.status === status).length;
  return {
    targets: deps.store.targets.listByCampaign(campaignId).length,
    drafts: count('draft'),
    approved: count('approved'),
    sent: count('sent'),
    failed: count('failed'),
    unknown: count('unknown'),
    replies: report.rates[0]?.numerator ?? 0,
    interested: report.rates[1]?.numerator ?? 0,
    rates: report.rates,
    warnings: report.warnings,
  };
};

export const campaignsView = (deps: Deps) =>
  deps.store.campaigns
    .all()
    .map((campaign) => ({ ...campaign, metrics: campaignMetrics(deps, campaign.id) }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

export const campaignDetailView = (deps: Deps, ref: string, info: RuntimeInfo) => {
  const { campaign, templates, targets, messages } = getCampaign(deps, ref);
  const open = campaign.status !== 'closed';
  const targetRows = targets.map((target) => {
    const company = deps.store.companies.findById(target.companyId)!;
    const contact = deps.store.contacts.findById(target.contactId);
    const own = messages.filter((message) => message.contactId === target.contactId);
    return {
      company: { ...companyRef(company), qualification: company.qualification },
      contact: contact ? { id: contact.id, name: contact.name, role: contact.role, email: contact.email, blockReason: contactBlockReason(deps, contact) } : undefined,
      messages: own.map((message) => ({ id: message.id, step: message.step, status: message.status, personalization: message.personalization, evidenceIds: message.evidenceIds })),
      addedAt: target.addedAt,
    };
  });
  const inCampaign = new Set(targets.map((target) => target.companyId));
  const candidates = open
    ? listCompanies(deps, { statuses: ['qualified'] })
        .filter((company) => !inCampaign.has(company.id))
        .map((company) => {
          const contact = pickContact(deps, company);
          const other = openCampaignFor(deps, company.id);
          const reason = other ? `já está na campanha aberta ${other.name}` : !contact ? 'sem contato com e-mail apto' : undefined;
          return {
            company: { ...companyRef(company), priority: company.priority, qualification: company.qualification },
            contact: contact ? { id: contact.id, name: contact.name, role: contact.role } : undefined,
            outsideMarket: !!campaign.market && campaign.market.toUpperCase() !== company.country,
            reason,
          };
        })
    : [];
  return {
    campaign,
    templates: [0, 1, 2, 3].slice(0, deps.sending.followUp.maxFollowUps + 1).map((step) => ({
      step,
      versions: templates.filter((template) => template.step === step).sort((a, b) => a.version - b.version),
    })),
    targets: targetRows,
    candidates,
    metrics: campaignMetrics(deps, campaign.id),
    sender: { configured: !!(deps.sender.name && deps.sender.email && deps.sender.postalAddress), ...deps.sender },
    transport: info.transport,
  };
};

const evidenceSummary = (deps: Deps, companyId: string, ids: string[]) =>
  deps.store.evidences
    .listByCompany(companyId)
    .filter((evidence) => ids.includes(evidence.id))
    .map((evidence) => ({ id: evidence.id, claim: evidence.claim, source: evidence.source, certainty: evidence.certainty }));

export const reviewQueueView = (deps: Deps, campaignRef?: string) => {
  const campaignId = campaignRef ? getCampaign(deps, campaignRef).campaign.id : undefined;
  return deps.store.messages.list({ campaignId, statuses: ['draft'] }).map((message) => {
    const company = deps.store.companies.findById(message.companyId)!;
    const contact = deps.store.contacts.findById(message.contactId);
    return {
      ...message,
      campaign: campaignName(deps, message.campaignId),
      from: { name: deps.sender.name, email: deps.sender.email },
      company: { ...companyRef(company), qualification: company.qualification, technologies: company.technologies },
      contact: contact ? { id: contact.id, name: contact.name, role: contact.role, decisionMaker: isDecisionMaker(deps, contact) } : undefined,
      evidences: evidenceSummary(deps, company.id, message.evidenceIds),
      verifiedEvidenceCount: deps.store.evidences.listByCompany(company.id).filter((evidence) => evidence.certainty === 'verified').length,
    };
  });
};

export const personalizeView = (deps: Deps, campaignRef: string, companyDomain: string) => {
  const { campaign } = getCampaign(deps, campaignRef);
  const detail = getCompanyHistory(deps, companyDomain);
  const target = deps.store.targets.listByCampaign(campaign.id).find((item) => item.companyId === detail.company.id);
  const contact = target ? deps.store.contacts.findById(target.contactId) : undefined;
  const message = contact ? deps.store.messages.find(campaign.id, contact.id, 0) : null;
  return {
    campaign: { id: campaign.id, name: campaign.name, status: campaign.status },
    company: detail.company,
    contact: contact ? { id: contact.id, name: contact.name, role: contact.role, email: contact.email } : undefined,
    inCampaign: !!target,
    evidences: detail.evidences,
    message,
  };
};

export const conciliationView = (deps: Deps) => {
  const withAttempts = (message: Message) => ({
    ...messageSummary(deps, message),
    attempts: deps.store.attempts.listByMessage(message.id),
  });
  return {
    unknown: deps.store.messages.list({ statuses: ['unknown'] }).map(withAttempts),
    failed: deps.store.messages.list({ statuses: ['failed'] }).map(withAttempts),
  };
};

export const followUpsView = (deps: Deps) =>
  followUpBoard(deps).map((item) => ({
    company: companyRef(item.company),
    contact: { id: item.contact.id, name: item.contact.name, email: item.contact.email },
    campaign: campaignName(deps, item.campaignId),
    firstSentAt: item.previous.sentAt,
    previousSubject: item.previous.subject,
    step: item.step,
    dueAt: item.dueAt,
    state: item.state,
    reason: item.reason,
    hasTemplate: !!approvedTemplate(deps, item.campaignId, item.step),
  }));

export const repliesView = (deps: Deps) =>
  deps.store.replies
    .list({})
    .map((reply) => {
      const company = deps.store.companies.findById(reply.companyId)!;
      const contact = deps.store.contacts.findById(reply.contactId);
      const message = reply.messageId ? deps.store.messages.findById(reply.messageId) : null;
      return {
        ...reply,
        company: companyRef(company),
        contact: contact ? { id: contact.id, name: contact.name, email: contact.email } : undefined,
        campaign: message ? campaignName(deps, message.campaignId) : undefined,
        effect: REPLY_EFFECTS[reply.category],
      };
    })
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || b.createdAt.localeCompare(a.createdAt));

// Contacts that can receive a reply: anyone with an e-mail, most recently messaged first.
export const replyContactsView = (deps: Deps) =>
  deps.store.contacts
    .all()
    .filter((contact) => contact.email)
    .map((contact) => {
      const company = deps.store.companies.findById(contact.companyId)!;
      const lastSent = deps.store.messages.list({ contactId: contact.id, statuses: ['sent'] }).at(-1);
      return { id: contact.id, name: contact.name, email: contact.email!, company: companyRef(company), lastSentAt: lastSent?.sentAt };
    })
    .sort((a, b) => (b.lastSentAt ?? '').localeCompare(a.lastSentAt ?? '') || a.name.localeCompare(b.name));

// Suppressions keep only a hash; the list shows which known contact or company each one matches.
export const suppressionsView = (deps: Deps) => {
  const contacts = deps.store.contacts.all().filter((contact) => contact.email);
  const companies = deps.store.companies.all();
  return deps.store.suppressions
    .all()
    .map((suppression) => {
      const lead = suppression.kind === 'phone' ? deps.store.leads.list().find((item) => hashValue(item.phone) === suppression.valueHash || (item.whatsapp && hashValue(item.whatsapp) === suppression.valueHash)) : undefined;
      const contact = suppression.kind === 'email' ? contacts.find((item) => hashValue(item.email!) === suppression.valueHash) : undefined;
      const company =
        suppression.kind === 'domain'
          ? companies.find((item) => hashValue(item.domain) === suppression.valueHash)
          : contact
            ? deps.store.companies.findById(contact.companyId) ?? undefined
            : undefined;
      return {
        ...suppression,
        hashPrefix: suppression.valueHash.slice(0, 10),
        lead: lead ? { id: lead.id, name: lead.name, phone: lead.phone } : undefined,
        contact: contact ? { id: contact.id, name: contact.name, email: contact.email } : undefined,
        company: company ? companyRef(company) : undefined,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};

export const settingsView = (deps: Deps, info: RuntimeInfo) => ({
  sender: deps.sender,
  transport: info.transport,
  delivers: info.delivers,
  smtp: info.smtp,
  paths: { database: info.databasePath, scoring: info.scoringPath, sending: info.sendingPath, outbox: info.outboxDir },
  sending: deps.sending,
  scoring: deps.scoring,
  footerPreview: (() => {
    try {
      const unsubscribeUrl = deps.unsubscribe?.url('exemplo@exemplo.com');
      return renderMessage({ subject: 'x', body: 'x' }, footerFor(deps.sending, unsubscribeUrl), { company: { name: 'x', matchingTechnologies: [] }, contact: { name: 'x' }, sender: deps.sender, unsubscribeUrl }).body.slice(3);
    } catch (error) {
      return `⚠ ${(error as Error).message}`;
    }
  })(),
});
