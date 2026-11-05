import type { Company } from '../entities/company.js';
import type { Contact } from '../entities/contact.js';
import type { Message } from '../entities/outreach.js';
import { DomainError } from '../errors.js';
import type { Deps } from '../ports/runtime.js';
import { draftMessage } from './messages.js';
import { contactBlockReason, followUpDueAt, resolveCampaign } from './outreach-shared.js';
import { hasStoppingReply } from './send.js';
import { today } from './shared.js';

export type DueFollowUp = { campaignId: string; company: Company; contact: Contact; previous: Message; step: number; dueAt: string };

// Checked on every listing, not stored: a reply, a do_not_contact or a suppression recorded after
// the previous send removes the follow-up immediately.
export const listDueFollowUps = (deps: Deps, options: { campaignRef?: string; asOf?: string } = {}): DueFollowUp[] => {
  const asOf = options.asOf ?? today(deps);
  const campaignId = options.campaignRef ? resolveCampaign(deps, options.campaignRef).id : undefined;
  const { maxFollowUps } = deps.sending.followUp;
  const due: DueFollowUp[] = [];
  for (const previous of deps.store.messages.list({ campaignId, statuses: ['sent'] })) {
    if (previous.step >= maxFollowUps || !previous.sentAt) continue;
    const campaign = deps.store.campaigns.findById(previous.campaignId)!;
    if (campaign.status !== 'active') continue;
    if (deps.store.messages.find(previous.campaignId, previous.contactId, previous.step + 1)) continue;
    const company = deps.store.companies.findById(previous.companyId)!;
    if (company.status !== 'contacted' || hasStoppingReply(deps, company.id)) continue;
    const contact = deps.store.contacts.findById(previous.contactId)!;
    if (contactBlockReason(deps, contact)) continue;
    const dueAt = followUpDueAt(deps, { ...previous, sentAt: previous.sentAt });
    if (dueAt <= asOf) due.push({ campaignId: previous.campaignId, company, contact, previous, step: previous.step + 1, dueAt });
  }
  return due;
};

export const draftDueFollowUps = (deps: Deps, campaignRef: string): { drafted: Message[]; skipped: { company: string; reason: string }[] } => {
  const drafted: Message[] = [];
  const skipped: { company: string; reason: string }[] = [];
  for (const item of listDueFollowUps(deps, { campaignRef })) {
    try {
      drafted.push(draftMessage(deps, item.campaignId, { companyRef: item.company.id, step: item.step }));
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      skipped.push({ company: item.company.domain, reason: error.message });
    }
  }
  return { drafted, skipped };
};

export type FollowUpBoardItem = {
  campaignId: string;
  company: Company;
  contact: Contact;
  previous: Message;
  step: number;
  dueAt: string;
  state: 'due' | 'waiting' | 'blocked';
  reason?: string;
};

// Every sent message that could still get a follow-up, with why it is due, waiting or blocked. Uses
// the same checks as listDueFollowUps so the two never disagree.
export const followUpBoard = (deps: Deps, options: { campaignRef?: string; asOf?: string } = {}): FollowUpBoardItem[] => {
  const asOf = options.asOf ?? today(deps);
  const campaignId = options.campaignRef ? resolveCampaign(deps, options.campaignRef).id : undefined;
  const { maxFollowUps } = deps.sending.followUp;
  const items: FollowUpBoardItem[] = [];
  for (const previous of deps.store.messages.list({ campaignId, statuses: ['sent'] })) {
    if (previous.step >= maxFollowUps || !previous.sentAt) continue;
    if (deps.store.messages.find(previous.campaignId, previous.contactId, previous.step + 1)) continue;
    const campaign = deps.store.campaigns.findById(previous.campaignId)!;
    const company = deps.store.companies.findById(previous.companyId)!;
    const contact = deps.store.contacts.findById(previous.contactId)!;
    const dueAt = followUpDueAt(deps, { ...previous, sentAt: previous.sentAt });
    const base = { campaignId: previous.campaignId, company, contact, previous, step: previous.step + 1, dueAt };
    const blocked =
      campaign.status !== 'active'
        ? `campanha está ${campaign.status}`
        : hasStoppingReply(deps, company.id)
          ? 'resposta já registrada'
          : company.status !== 'contacted'
            ? `empresa está em ${company.status}`
            : contactBlockReason(deps, contact);
    if (blocked) items.push({ ...base, state: 'blocked', reason: blocked });
    else items.push({ ...base, state: dueAt <= asOf ? 'due' : 'waiting' });
  }
  return items;
};
