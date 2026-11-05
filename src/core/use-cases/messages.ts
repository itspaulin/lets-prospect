import { z } from 'zod';
import { keepWanted } from '../rules/technology.js';
import type { Message, MessageStatus } from '../entities/outreach.js';
import { DomainError } from '../errors.js';
import type { Deps } from '../ports/runtime.js';
import { emailDomain } from '../rules/normalize.js';
import { assertTemplatePlaceholders, contentHash, footerFor, renderMessage } from '../rules/render.js';
import { approvedTemplate } from './campaigns.js';
import { contactBlockReason, resolveCampaign } from './outreach-shared.js';
import { nowIso, parseInput, record, resolveCompany } from './shared.js';

const EDITABLE: MessageStatus[] = ['draft', 'approved'];

export const matchingTechnologies = (deps: Deps, technologies: string[]): string[] =>
  keepWanted(technologies, deps.scoring.criteria.flatMap((criterion) => (criterion.type === 'technology_overlap' ? criterion.technologies : [])));

export type DraftInput = { companyRef: string; step?: number; reason?: string; evidenceIds?: string[] };

// Builds (or rebuilds) the draft for one campaign target. A personal reason must cite at least one
// verified evidence of that company; without it the draft is generic and says so.
export const draftMessage = (deps: Deps, campaignRef: string, input: DraftInput): Message =>
  deps.store.transaction(() => {
    const campaign = resolveCampaign(deps, campaignRef);
    if (campaign.status === 'closed') throw new DomainError('validation', 'Campanha encerrada');
    const company = resolveCompany(deps, input.companyRef);
    const target = deps.store.targets.listByCampaign(campaign.id).find((item) => item.companyId === company.id);
    if (!target) throw new DomainError('not_found', `${company.domain} não está na campanha "${campaign.name}"`);
    const step = input.step ?? 0;
    const template = approvedTemplate(deps, campaign.id, step);
    if (!template) throw new DomainError('requirement_missing', `Campanha sem template aprovado para a etapa ${step}`);
    const contact = deps.store.contacts.findById(target.contactId)!;
    const blocked = contactBlockReason(deps, contact);
    if (blocked) throw new DomainError('validation', `${contact.name}: ${blocked}`);

    const reason = input.reason?.trim() || undefined;
    const evidenceIds = input.evidenceIds ?? [];
    if (reason) {
      if (evidenceIds.length === 0) throw new DomainError('requirement_missing', 'Motivo personalizado exige --evidence com o id de um fato verificado');
      const evidences = deps.store.evidences.listByCompany(company.id);
      for (const id of evidenceIds) {
        const evidence = evidences.find((item) => item.id === id);
        if (!evidence) throw new DomainError('not_found', `Evidência ${id} não pertence a ${company.domain}`);
        if (evidence.certainty !== 'verified') throw new DomainError('validation', `Evidência ${id} é hipótese; personalização exige fato verificado`);
      }
    } else if (evidenceIds.length) throw new DomainError('validation', '--evidence sem --reason não tem efeito');

    const unsubscribeUrl = deps.unsubscribe?.url(contact.email!);
    const rendered = renderMessage(template, footerFor(deps.sending, unsubscribeUrl), {
      company: { name: company.name, matchingTechnologies: matchingTechnologies(deps, company.technologies) },
      contact: { name: contact.name },
      sender: deps.sender,
      reason,
      unsubscribeUrl,
    });
    const existing = deps.store.messages.find(campaign.id, contact.id, step);
    if (existing && !EDITABLE.includes(existing.status))
      throw new DomainError('validation', `Mensagem já está ${existing.status}; não pode ser refeita`);
    const now = nowIso(deps);
    const id = existing?.id ?? deps.newId();
    const message: Message = {
      id,
      campaignId: campaign.id,
      companyId: company.id,
      contactId: contact.id,
      templateId: template.id,
      step,
      toEmail: contact.email!,
      ...rendered,
      evidenceIds: reason ? evidenceIds : [],
      status: 'draft',
      headerMessageId: existing?.headerMessageId ?? `<${id}@${emailDomain(deps.sender.email || 'localhost.invalid')}>`,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (existing) deps.store.messages.update(message);
    else deps.store.messages.insert(message);
    record(deps, {
      companyId: company.id,
      contactId: contact.id,
      type: 'message_drafted',
      summary: `Rascunho etapa ${step} (${rendered.personalization === 'generic' ? 'genérico' : 'personalizado com evidência'}) em "${campaign.name}", template v${template.version}`,
      data: { messageId: id, evidenceIds: message.evidenceIds },
    });
    return message;
  });

export const draftAll = (deps: Deps, campaignRef: string): { drafted: Message[]; skipped: { company: string; reason: string }[] } => {
  const campaign = resolveCampaign(deps, campaignRef);
  const drafted: Message[] = [];
  const skipped: { company: string; reason: string }[] = [];
  for (const target of deps.store.targets.listByCampaign(campaign.id)) {
    if (deps.store.messages.find(campaign.id, target.contactId, 0)) continue;
    const company = deps.store.companies.findById(target.companyId)!;
    try {
      drafted.push(draftMessage(deps, campaign.id, { companyRef: company.id }));
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      skipped.push({ company: company.domain, reason: error.message });
    }
  }
  return { drafted, skipped };
};

export const resolveMessage = (deps: Deps, id: string): Message => {
  const message = deps.store.messages.findById(id);
  if (!message) throw new DomainError('not_found', `Mensagem não encontrada: ${id}`);
  return message;
};

export const editMessage = (deps: Deps, id: string, input: { subject: string; body: string }): Message => {
  const data = parseInput(z.object({ subject: z.string().trim().min(1), body: z.string().trim().min(1) }), input);
  return deps.store.transaction(() => {
    const message = resolveMessage(deps, id);
    if (!EDITABLE.includes(message.status)) throw new DomainError('validation', `Mensagem ${message.status} não pode ser editada`);
    if (message.subject === data.subject && message.body === data.body) return message;
    const updated: Message = { ...message, ...data, status: 'draft', contentHash: undefined, approvedAt: undefined, updatedAt: nowIso(deps) };
    deps.store.messages.update(updated);
    record(deps, { companyId: message.companyId, contactId: message.contactId, type: 'message_drafted', summary: `Rascunho etapa ${message.step} editado manualmente`, data: { messageId: id } });
    return updated;
  });
};

export const approveMessage = (deps: Deps, id: string): Message =>
  deps.store.transaction(() => {
    const message = resolveMessage(deps, id);
    if (message.status !== 'draft') throw new DomainError('invalid_transition', `Mensagem está ${message.status}; só rascunhos são aprovados`);
    const campaign = deps.store.campaigns.findById(message.campaignId)!;
    if (campaign.status === 'closed') throw new DomainError('validation', 'Campanha encerrada');
    const now = nowIso(deps);
    const approved: Message = { ...message, status: 'approved', contentHash: contentHash(message), approvedAt: now, updatedAt: now };
    deps.store.messages.update(approved);
    record(deps, {
      companyId: message.companyId,
      contactId: message.contactId,
      type: 'message_approved',
      summary: `Mensagem etapa ${message.step} aprovada (${message.personalization === 'generic' ? 'genérica' : 'personalizada'})`,
      data: { messageId: id, contentHash: approved.contentHash },
    });
    return approved;
  });

export const cancelMessage = (deps: Deps, id: string, reason: string): Message =>
  deps.store.transaction(() => {
    const message = resolveMessage(deps, id);
    if (!['draft', 'approved', 'failed'].includes(message.status)) throw new DomainError('invalid_transition', `Mensagem ${message.status} não pode ser cancelada`);
    return cancelInTransaction(deps, message, reason);
  });

export const cancelInTransaction = (deps: Deps, message: Message, reason: string): Message => {
  const cancelled: Message = { ...message, status: 'cancelled', cancelReason: reason, updatedAt: nowIso(deps) };
  deps.store.messages.update(cancelled);
  record(deps, { companyId: message.companyId, contactId: message.contactId, type: 'message_cancelled', summary: `Mensagem etapa ${message.step} cancelada: ${reason}`, data: { messageId: message.id } });
  return cancelled;
};

export const retryFailedMessage = (deps: Deps, id: string): Message =>
  deps.store.transaction(() => {
    const message = resolveMessage(deps, id);
    if (message.status !== 'failed') throw new DomainError('invalid_transition', `Só mensagens failed podem ser reenviadas; esta está ${message.status}`);
    const updated: Message = { ...message, status: 'approved', error: undefined, updatedAt: nowIso(deps) };
    deps.store.messages.update(updated);
    return updated;
  });

export const listMessages = (deps: Deps, filter: { campaignRef?: string; statuses?: MessageStatus[] }): Message[] =>
  deps.store.messages.list({ campaignId: filter.campaignRef ? resolveCampaign(deps, filter.campaignRef).id : undefined, statuses: filter.statuses });

export type PreviewInput = { step: number; subject?: string; body?: string; companyRef?: string; reason?: string };

// Renders a template exactly as draftMessage would, without saving anything, so a template can be
// checked against a real company before it is approved.
export const previewMessage = (deps: Deps, campaignRef: string, input: PreviewInput) => {
  const campaign = resolveCampaign(deps, campaignRef);
  const latest = deps.store.templates.latest(campaign.id, input.step);
  const subject = input.subject ?? latest?.subject;
  const body = input.body ?? latest?.body;
  if (!subject || !body) throw new DomainError('requirement_missing', `Campanha sem template para a etapa ${input.step}`);
  assertTemplatePlaceholders(subject);
  assertTemplatePlaceholders(body);
  const company = input.companyRef ? resolveCompany(deps, input.companyRef) : undefined;
  const target = company ? deps.store.targets.listByCampaign(campaign.id).find((item) => item.companyId === company.id) : undefined;
  const contact = target ? deps.store.contacts.findById(target.contactId) : company ? deps.store.contacts.listByCompany(company.id).find((item) => item.email) : undefined;
  const unsubscribeUrl = deps.unsubscribe?.url(contact?.email ?? 'alex@example.com');
  const rendered = renderMessage({ subject, body }, footerFor(deps.sending, unsubscribeUrl), {
    company: { name: company?.name ?? 'Example Agency', matchingTechnologies: company ? matchingTechnologies(deps, company.technologies) : ['Node.js', 'React'] },
    contact: { name: contact?.name ?? 'Alex Example' },
    sender: deps.sender,
    reason: input.reason,
    unsubscribeUrl,
  });
  return { ...rendered, to: contact?.email ?? 'alex@example.com', from: { name: deps.sender.name, email: deps.sender.email } };
};
