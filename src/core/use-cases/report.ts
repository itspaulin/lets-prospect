import type { CompanyStatus } from '../entities/company.js';
import { COMPANY_STATUSES } from '../entities/company.js';
import type { Message } from '../entities/outreach.js';
import type { Deps } from '../ports/runtime.js';
import { INTEREST_CATEGORIES, RESPONSE_CATEGORIES } from '../rules/replies.js';
import { listDueFollowUps } from './followups.js';
import { listReadyForContact, resolveCampaign } from './outreach-shared.js';

export type Rate = { name: string; numerator: number; denominator: number; value: number | null; definition: string };
export type Cohort = { label: string; reached: number; responded: number; interested: number; rates: Rate[] };

export type Report = {
  period: { from?: string; to?: string; campaign?: string };
  operational: Record<string, number>;
  companiesByStatus: Record<CompanyStatus, number>;
  rates: Rate[];
  byCampaign: Cohort[];
  byCountry: Cohort[];
  byPersonalization: Cohort[];
  warnings: string[];
};

const MIN_SAMPLE = 30;
const rate = (name: string, numerator: number, denominator: number, definition: string): Rate => ({
  name,
  numerator,
  denominator,
  value: denominator === 0 ? null : Math.round((numerator / denominator) * 1000) / 10,
  definition,
});

// The cohort is the set of contacts whose first message (step 0) was sent inside the period. Replies
// and conversions of that cohort count whenever they happened, so recent periods look worse until
// replies arrive. Delivery and opens are not reported: SMTP does not provide them reliably.
export const buildReport = (deps: Deps, options: { campaignRef?: string; from?: string; to?: string } = {}): Report => {
  const campaignId = options.campaignRef ? resolveCampaign(deps, options.campaignRef).id : undefined;
  const inPeriod = (iso: string | undefined) => !!iso && (!options.from || iso.slice(0, 10) >= options.from) && (!options.to || iso.slice(0, 10) <= options.to);

  const messages = deps.store.messages.list({ campaignId });
  const firstSends = messages.filter((message) => message.step === 0 && message.status === 'sent' && inPeriod(message.sentAt));
  const attempts = deps.store.attempts.all().filter((attempt) => (!campaignId || attempt.campaignId === campaignId) && inPeriod(attempt.startedAt));
  const replies = deps.store.replies.list({});
  const companies = deps.store.companies.all();

  const cohort = (label: string, sends: Message[]): Cohort => {
    const contacts = new Set(sends.map((message) => message.contactId));
    const companyIds = new Set(sends.map((message) => message.companyId));
    const responded = new Set(replies.filter((reply) => contacts.has(reply.contactId) && RESPONSE_CATEGORIES.includes(reply.category)).map((reply) => reply.contactId));
    const interested = new Set(replies.filter((reply) => contacts.has(reply.contactId) && INTEREST_CATEGORIES.includes(reply.category)).map((reply) => reply.contactId));
    const converted = companies.filter((company) => companyIds.has(company.id) && company.status === 'converted').length;
    return {
      label,
      reached: contacts.size,
      responded: responded.size,
      interested: interested.size,
      rates: [
        rate('Taxa de resposta', responded.size, contacts.size, 'contatos com resposta humana (exclui automática e endereço inválido) / contatos com primeiro e-mail enviado'),
        rate('Taxa de interesse', interested.size, responded.size, 'contatos com resposta de interesse, pedido de informações ou de currículo / contatos com resposta'),
        rate('Taxa de conversão', converted, companyIds.size, 'empresas em converted / empresas abordadas'),
      ],
    };
  };

  const group = (key: (message: Message) => string) => {
    const groups = new Map<string, Message[]>();
    for (const message of firstSends) groups.set(key(message), [...(groups.get(key(message)) ?? []), message]);
    return [...groups.entries()].map(([label, sends]) => cohort(label, sends)).sort((a, b) => b.reached - a.reached);
  };
  const campaignName = (id: string) => deps.store.campaigns.findById(id)?.name ?? id;
  const countryOf = (companyId: string) => companies.find((company) => company.id === companyId)?.country ?? '?';

  const overall = cohort('geral', firstSends);
  const failed = attempts.filter((attempt) => attempt.outcome === 'failed').length;
  const unknown = attempts.filter((attempt) => attempt.outcome === 'unknown').length;
  const companiesByStatus = Object.fromEntries(COMPANY_STATUSES.map((status) => [status, companies.filter((company) => company.status === status).length])) as Record<CompanyStatus, number>;

  const warnings: string[] = [];
  if (overall.reached === 0) warnings.push('Nenhum primeiro contato enviado no período: as taxas ficam indefinidas.');
  else if (overall.reached < MIN_SAMPLE) warnings.push(`Amostra pequena (${overall.reached} contatos abordados): trate as taxas como indício, não como conclusão.`);
  if (unknown > 0) warnings.push(`${unknown} tentativa(s) com resultado desconhecido: concilie com "message resolve" antes de confiar nos números.`);

  return {
    period: { from: options.from, to: options.to, campaign: options.campaignRef },
    operational: {
      'Empresas cadastradas': companies.length,
      'Empresas qualificadas (status atual)': companiesByStatus.qualified,
      'Contatos identificados': deps.store.contacts.all().length,
      'Empresas prontas para abordagem': listReadyForContact(deps).length,
      'Mensagens enviadas com sucesso (período)': messages.filter((message) => message.status === 'sent' && inPeriod(message.sentAt)).length,
      'Tentativas de envio (período)': attempts.length,
      'Falhas de envio (período)': failed,
      'Envios sem confirmação (período)': unknown,
      'Follow-ups vencidos': listDueFollowUps(deps, { campaignRef: options.campaignRef }).length,
      'Respostas registradas': replies.length,
      'Empresas em do_not_contact': companiesByStatus.do_not_contact,
      'Oportunidades em andamento (interested + opportunity)': companiesByStatus.interested + companiesByStatus.opportunity,
      'Contratações ou colaborações (converted)': companiesByStatus.converted,
    },
    companiesByStatus,
    rates: [...overall.rates, rate('Taxa de falha de envio', failed, attempts.length, 'tentativas com falha do provedor / tentativas de envio (unknown fica fora do numerador)')],
    byCampaign: group((message) => campaignName(message.campaignId)),
    byCountry: group((message) => countryOf(message.companyId)),
    byPersonalization: group((message) => message.personalization),
    warnings,
  };
};
