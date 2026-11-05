import type { Company } from '../entities/company.js';
import type { Contact } from '../entities/contact.js';
import type { Campaign, Message } from '../entities/outreach.js';
import { contentHash } from './render.js';

export type EligibilityInput = {
  message: Message;
  campaign: Campaign;
  company: Company;
  contact: Contact | null;
  suppressed: boolean;
  hasReply: boolean;
  previousStepSent: boolean;
};

export type Eligibility = { ok: true } | { ok: false; permanent: boolean; reason: string };

const blocked = (reason: string, permanent = true): Eligibility => ({ ok: false, permanent, reason });

// Permanent blocks cancel the message; transient ones (campaign paused) leave it approved for later.
export const checkEligibility = ({ message, campaign, company, contact, suppressed, hasReply, previousStepSent }: EligibilityInput): Eligibility => {
  if (campaign.status !== 'active') return blocked(`campanha está ${campaign.status}`, false);
  if (!contact) return blocked('contato não existe mais');
  if (contact.doNotContact) return blocked('contato marcado para não receber mensagens');
  if (contact.verificationStatus === 'invalid') return blocked('e-mail do contato marcado como inválido');
  if (!contact.email || contact.email !== message.toEmail) return blocked('e-mail do contato mudou depois da aprovação');
  if (suppressed) return blocked('destinatário ou domínio na lista de supressão');
  if (message.contentHash !== contentHash(message)) return blocked('conteúdo alterado depois da aprovação');
  if (message.step === 0) {
    if (company.status !== 'qualified') return blocked(`empresa está em ${company.status}; primeiro contato exige qualified`);
  } else {
    if (company.status !== 'contacted') return blocked(`empresa está em ${company.status}; follow-up exige contacted`);
    if (hasReply) return blocked('empresa já respondeu');
    if (!previousStepSent) return blocked('etapa anterior não foi enviada');
  }
  return { ok: true };
};
