import { z } from 'zod';
import type { Company } from '../entities/company.js';
import type { Contact } from '../entities/contact.js';
import type { Campaign, CampaignTarget, Template } from '../entities/outreach.js';
import { DomainError } from '../errors.js';
import type { Deps } from '../ports/runtime.js';
import { assertTemplatePlaceholders } from '../rules/render.js';
import { campaignTargetSegment } from '../rules/segments.js';
import { contactBlockReason, openCampaignFor, pickContact, resolveCampaign } from './outreach-shared.js';
import { nowIso, parseInput, record, resolveCompany } from './shared.js';
import { resolveContact } from './contacts.js';

const text = z.string().trim().min(1);

export const createCampaign = (deps: Deps, input: { name: string; criteria?: string; market?: string; segment?: string; notes?: string }): Campaign => {
  const data = parseInput(z.object({ name: text, criteria: text.optional(), market: text.optional(), segment: text.optional(), notes: text.optional() }), input);
  return deps.store.transaction(() => {
    if (deps.store.campaigns.findByName(data.name)) throw new DomainError('duplicate', `Campanha já existe: ${data.name}`);
    const now = nowIso(deps);
    const campaign: Campaign = { ...data, id: deps.newId(), status: 'draft', createdAt: now, updatedAt: now };
    deps.store.campaigns.insert(campaign);
    return campaign;
  });
};

export const setTemplate = (deps: Deps, campaignRef: string, input: { step: number; subject: string; body: string }): Template => {
  const data = parseInput(z.object({ step: z.number().int().min(0), subject: text, body: text }), input);
  assertTemplatePlaceholders(data.subject);
  assertTemplatePlaceholders(data.body);
  return deps.store.transaction(() => {
    const campaign = resolveCampaign(deps, campaignRef);
    if (campaign.status === 'closed') throw new DomainError('validation', 'Campanha encerrada');
    if (data.step > deps.sending.followUp.maxFollowUps)
      throw new DomainError('validation', `Etapa ${data.step} acima do máximo de follow-ups configurado (${deps.sending.followUp.maxFollowUps})`);
    const latest = deps.store.templates.latest(campaign.id, data.step);
    const template: Template = { ...data, id: deps.newId(), campaignId: campaign.id, version: (latest?.version ?? 0) + 1, createdAt: nowIso(deps) };
    deps.store.templates.insert(template);
    return template;
  });
};

export const approveTemplate = (deps: Deps, campaignRef: string, step: number): Template =>
  deps.store.transaction(() => {
    const campaign = resolveCampaign(deps, campaignRef);
    const latest = deps.store.templates.latest(campaign.id, step);
    if (!latest) throw new DomainError('not_found', `Campanha sem template para a etapa ${step}`);
    if (latest.approvedAt) throw new DomainError('validation', `Template v${latest.version} da etapa ${step} já está aprovado`);
    const approved = { ...latest, approvedAt: nowIso(deps) };
    deps.store.templates.update(approved);
    return approved;
  });

export const approvedTemplate = (deps: Deps, campaignId: string, step: number): Template | null =>
  deps.store.templates.listByCampaign(campaignId).filter((template) => template.step === step && template.approvedAt).at(-1) ?? null;

const setCampaignStatus = (deps: Deps, ref: string, allowed: Campaign['status'][], to: Campaign['status'], extra: Partial<Campaign> = {}): Campaign =>
  deps.store.transaction(() => {
    const campaign = resolveCampaign(deps, ref);
    if (!allowed.includes(campaign.status)) throw new DomainError('invalid_transition', `Campanha está ${campaign.status}; não pode ir para ${to}`);
    const updated = { ...campaign, ...extra, status: to, updatedAt: nowIso(deps) };
    deps.store.campaigns.update(updated);
    return updated;
  });

// Activating is the human approval of the campaign (spec 8.2): it requires an approved first-contact template.
export const activateCampaign = (deps: Deps, ref: string): Campaign => {
  const campaign = resolveCampaign(deps, ref);
  if (!approvedTemplate(deps, campaign.id, 0)) throw new DomainError('requirement_missing', 'Aprove o template da etapa 0 antes de ativar a campanha');
  return setCampaignStatus(deps, ref, ['draft', 'paused'], 'active', { approvedAt: campaign.approvedAt ?? nowIso(deps) });
};
export const pauseCampaign = (deps: Deps, ref: string): Campaign => setCampaignStatus(deps, ref, ['active'], 'paused');
export const closeCampaign = (deps: Deps, ref: string): Campaign => setCampaignStatus(deps, ref, ['draft', 'active', 'paused'], 'closed');

const addTargetInTransaction = (deps: Deps, campaign: Campaign, company: Company, contact: Contact): CampaignTarget => {
  if (company.status !== 'qualified') throw new DomainError('validation', `${company.domain} está em ${company.status}; só empresas qualified entram em campanha`);
  const open = openCampaignFor(deps, company.id);
  if (open) throw new DomainError('duplicate', `${company.domain} já está na campanha "${open.name}"`);
  if (contact.companyId !== company.id) throw new DomainError('validation', `${contact.name} não pertence a ${company.domain}`);
  const blocked = contactBlockReason(deps, contact);
  if (blocked) throw new DomainError('validation', `${contact.name}: ${blocked}`);
  const target: CampaignTarget = { id: deps.newId(), campaignId: campaign.id, companyId: company.id, contactId: contact.id, addedAt: nowIso(deps) };
  deps.store.targets.insert(target);
  record(deps, { companyId: company.id, contactId: contact.id, type: 'campaign_target_added', summary: `Adicionada à campanha "${campaign.name}" (contato: ${contact.name})` });
  return target;
};

export const addTarget = (deps: Deps, campaignRef: string, companyRef: string, contactRef?: string): CampaignTarget =>
  deps.store.transaction(() => {
    const campaign = resolveCampaign(deps, campaignRef);
    if (campaign.status === 'closed') throw new DomainError('validation', 'Campanha encerrada');
    const company = resolveCompany(deps, companyRef);
    const contact = contactRef ? resolveContact(deps, contactRef) : pickContact(deps, company);
    if (!contact) throw new DomainError('requirement_missing', `${company.domain} não tem contato com e-mail apto`);
    return addTargetInTransaction(deps, campaign, company, contact);
  });

// A campaign whose segment is "software house" or "consultoria de TI" only takes companies of that kind. A company the AI has not
// typed (added by hand, or judged before the kind existed) is left out of such campaigns, with the reason.
const segmentMismatch = (campaign: Campaign, company: Company): string | undefined => {
  const wanted = campaignTargetSegment(campaign.segment);
  if (!wanted || company.segment?.toLowerCase() === wanted.toLowerCase()) return undefined;
  return company.segment ? `é ${company.segment}; a campanha é de ${wanted}` : `sem tipo definido; a campanha é de ${wanted}`;
};

export const selectTargets = (
  deps: Deps,
  campaignRef: string,
  filter: { countries?: string[]; priority?: Company['priority']; limit?: number },
): { added: { company: Company; contact: Contact }[]; skipped: { company: Company; reason: string }[] } => {
  const campaign = resolveCampaign(deps, campaignRef);
  const added: { company: Company; contact: Contact }[] = [];
  const skipped: { company: Company; reason: string }[] = [];
  for (const company of deps.store.companies.list({ statuses: ['qualified'], countries: filter.countries, priority: filter.priority })) {
    if (filter.limit !== undefined && added.length >= filter.limit) break;
    const mismatch = segmentMismatch(campaign, company);
    if (mismatch) {
      skipped.push({ company, reason: mismatch });
      continue;
    }
    const contact = pickContact(deps, company);
    if (!contact) {
      skipped.push({ company, reason: 'sem contato com e-mail apto' });
      continue;
    }
    try {
      deps.store.transaction(() => addTargetInTransaction(deps, campaign, company, contact));
      added.push({ company, contact });
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      skipped.push({ company, reason: error.message });
    }
  }
  return { added, skipped };
};

export const getCampaign = (deps: Deps, ref: string) => {
  const campaign = resolveCampaign(deps, ref);
  return {
    campaign,
    templates: deps.store.templates.listByCampaign(campaign.id),
    targets: deps.store.targets.listByCampaign(campaign.id),
    messages: deps.store.messages.list({ campaignId: campaign.id }),
  };
};
