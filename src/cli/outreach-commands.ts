import { existsSync, readFileSync } from 'node:fs';
import { parseArgs, type ParseArgsConfig } from 'node:util';
import type { Priority } from '../core/entities/company.js';
import { MESSAGE_STATUSES, type Message, type MessageStatus, REPLY_CATEGORIES, type ReplyCategory } from '../core/entities/outreach.js';
import { DomainError } from '../core/errors.js';
import type { Deps } from '../core/ports/runtime.js';
import {
  activateCampaign,
  addTarget,
  approveTemplate,
  closeCampaign,
  createCampaign,
  getCampaign,
  pauseCampaign,
  selectTargets,
  setTemplate,
} from '../core/use-cases/campaigns.js';
import { draftDueFollowUps, listDueFollowUps } from '../core/use-cases/followups.js';
import { approveMessage, cancelMessage, draftAll, draftMessage, editMessage, listMessages, resolveMessage, retryFailedMessage } from '../core/use-cases/messages.js';
import { listReadyForContact } from '../core/use-cases/outreach-shared.js';
import { erasePersonalData } from '../core/use-cases/privacy.js';
import { correctReply, listReplies, recordReply } from '../core/use-cases/replies.js';
import { buildReport } from '../core/use-cases/report.js';
import { resolveUnknown, sendApproved } from '../core/use-cases/send.js';
import { suppressDomain, suppressEmail } from '../core/use-cases/suppressions.js';
import { resolveCompany } from '../core/use-cases/shared.js';
import { formatMessage, formatMessageRow, formatReport, formatSendReport } from './outreach-format.js';

export type Io = {
  out: (line: string) => void;
  err: (line: string) => void;
  prompt: (question: string) => Promise<string>;
  edit: (text: string) => Promise<string>;
};

const s = { type: 'string' } as const;
const b = { type: 'boolean' } as const;

const parse = (args: string[], options: ParseArgsConfig['options']) => {
  const { values, positionals } = parseArgs({ args, options, allowPositionals: true, strict: true });
  return { values: values as Record<string, string | boolean | undefined>, positionals };
};
const str = (values: Record<string, unknown>, key: string) => (typeof values[key] === 'string' ? (values[key] as string) : undefined);
const required = (positionals: string[], index: number, label: string): string => {
  const value = positionals[index];
  if (!value) throw new DomainError('validation', `Informe ${label}`);
  return value;
};
const list = (raw: string | undefined) => raw?.split(',').map((item) => item.trim()).filter(Boolean);
const int = (raw: string | undefined, flag: string): number | undefined => {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new DomainError('validation', `--${flag} deve ser inteiro`);
  return value;
};
const domainOf = (deps: Deps) => (message: Message) => deps.store.companies.findById(message.companyId)?.domain ?? '?';

const toEditable = (message: Message) => `Subject: ${message.subject}\n\n${message.body}\n`;
const fromEditable = (text: string): { subject: string; body: string } => {
  const match = text.match(/^Subject:[ \t]*(.*)\r?\n\r?\n([\s\S]*)$/);
  if (!match) throw new DomainError('validation', 'Formato esperado: primeira linha "Subject: ...", linha em branco, corpo');
  return { subject: match[1]!.trim(), body: match[2]!.trim() };
};

const editInteractively = async (deps: Deps, io: Io, message: Message): Promise<Message> => editMessage(deps, message.id, fromEditable(await io.edit(toEditable(message))));

export const companyReady = (deps: Deps, io: Io): void => {
  const ready = listReadyForContact(deps);
  if (ready.length === 0) io.out('Nenhuma empresa pronta: precisa estar qualified, ter contato com e-mail apto e não estar em campanha aberta.');
  for (const { company, contact } of ready) io.out(`${company.domain.padEnd(28)} ${company.country}  ${(company.priority ?? '-').padEnd(6)} ${contact.name}${contact.role ? `, ${contact.role}` : ''} <${contact.email}>`);
};

export const campaignCommand = async (deps: Deps, sub: string | undefined, args: string[], io: Io): Promise<void> => {
  switch (sub) {
    case 'create': {
      const { values, positionals } = parse(args, { criteria: s, market: s, segment: s, notes: s });
      const campaign = createCampaign(deps, { name: required(positionals, 0, 'o nome'), criteria: str(values, 'criteria'), market: str(values, 'market'), segment: str(values, 'segment'), notes: str(values, 'notes') });
      io.out(`Campanha criada em draft: ${campaign.name}. Próximo: campaign template, campaign approve-template, campaign activate.`);
      return;
    }
    case 'template': {
      const { values, positionals } = parse(args, { step: s, subject: s, file: s });
      const file = str(values, 'file');
      if (!file || !existsSync(file)) throw new DomainError('validation', 'Informe --file com o corpo do template');
      const template = setTemplate(deps, required(positionals, 0, 'a campanha'), { step: int(str(values, 'step'), 'step') ?? 0, subject: str(values, 'subject') ?? '', body: readFileSync(file, 'utf8') });
      io.out(`Template etapa ${template.step} v${template.version} salvo (aguardando aprovação).`);
      return;
    }
    case 'approve-template': {
      const { values, positionals } = parse(args, { step: s });
      const campaign = required(positionals, 0, 'a campanha');
      const step = int(str(values, 'step'), 'step') ?? 0;
      const pending = getCampaign(deps, campaign).templates.filter((template) => template.step === step).at(-1);
      if (!pending) throw new DomainError('not_found', `Sem template para a etapa ${step}`);
      io.out(`Assunto: ${pending.subject}\n\n${pending.body}\n`);
      if ((await io.prompt(`Aprovar template etapa ${step} v${pending.version}? (s/N) `)).trim().toLowerCase() !== 's') return io.out('Não aprovado.');
      const template = approveTemplate(deps, campaign, step);
      io.out(`Template etapa ${step} v${template.version} aprovado.`);
      return;
    }
    case 'activate':
    case 'pause':
    case 'close': {
      const { positionals } = parse(args, {});
      const action = { activate: activateCampaign, pause: pauseCampaign, close: closeCampaign }[sub];
      const campaign = action(deps, required(positionals, 0, 'a campanha'));
      io.out(`${campaign.name}: ${campaign.status}`);
      return;
    }
    case 'add': {
      const { values, positionals } = parse(args, { contact: s });
      addTarget(deps, required(positionals, 0, 'a campanha'), required(positionals, 1, 'a empresa'), str(values, 'contact'));
      io.out('Empresa adicionada à campanha.');
      return;
    }
    case 'select': {
      const { values, positionals } = parse(args, { country: s, priority: s, limit: s });
      const result = selectTargets(deps, required(positionals, 0, 'a campanha'), { countries: list(str(values, 'country')), priority: str(values, 'priority') as Priority | undefined, limit: int(str(values, 'limit'), 'limit') });
      result.added.forEach(({ company, contact }) => io.out(`  + ${company.domain} -> ${contact.name} <${contact.email}>`));
      result.skipped.forEach(({ company, reason }) => io.out(`  - ${company.domain}: ${reason}`));
      io.out(`Adicionadas: ${result.added.length} | ignoradas: ${result.skipped.length}`);
      return;
    }
    case 'show': {
      const { positionals } = parse(args, {});
      const { campaign, templates, targets, messages } = getCampaign(deps, required(positionals, 0, 'a campanha'));
      io.out(`${campaign.name} [${campaign.status}]${campaign.market ? ` mercado ${campaign.market}` : ''}${campaign.segment ? ` segmento ${campaign.segment}` : ''}`);
      if (campaign.criteria) io.out(`Critérios: ${campaign.criteria}`);
      if (campaign.approvedAt) io.out(`Aprovada em ${campaign.approvedAt}`);
      templates.forEach((template) => io.out(`  template etapa ${template.step} v${template.version} ${template.approvedAt ? 'aprovado' : 'PENDENTE'}: ${template.subject}`));
      io.out(`Empresas: ${targets.length}`);
      const counts = MESSAGE_STATUSES.map((status) => [status, messages.filter((message) => message.status === status).length] as const).filter(([, count]) => count);
      io.out(`Mensagens: ${counts.map(([status, count]) => `${status} ${count}`).join(' | ') || 'nenhuma'}`);
      return;
    }
    case 'list': {
      for (const campaign of deps.store.campaigns.all()) io.out(`${campaign.name.padEnd(28)} ${campaign.status.padEnd(7)} ${deps.store.targets.listByCampaign(campaign.id).length} empresas`);
      return;
    }
    default:
      throw new DomainError('validation', `Subcomando desconhecido: campaign ${sub ?? ''}`);
  }
};

export const messageCommand = async (deps: Deps, sub: string | undefined, args: string[], io: Io): Promise<void> => {
  const companyOf = domainOf(deps);
  switch (sub) {
    case 'draft': {
      const { values, positionals } = parse(args, { reason: s, evidence: s, step: s });
      const message = draftMessage(deps, required(positionals, 0, 'a campanha'), {
        companyRef: required(positionals, 1, 'a empresa'),
        reason: str(values, 'reason'),
        evidenceIds: list(str(values, 'evidence')),
        step: int(str(values, 'step'), 'step'),
      });
      formatMessage(message, companyOf(message)).forEach(io.out);
      return;
    }
    case 'draft-all': {
      const { positionals } = parse(args, {});
      const result = draftAll(deps, required(positionals, 0, 'a campanha'));
      io.out(`Rascunhos genéricos criados: ${result.drafted.length}. Para personalizar: message draft <campanha> <empresa> --reason "..." --evidence <id>`);
      result.skipped.forEach((item) => io.out(`  - ${item.company}: ${item.reason}`));
      return;
    }
    case 'list': {
      const { values, positionals } = parse(args, { status: s });
      const statuses = list(str(values, 'status')) as MessageStatus[] | undefined;
      const invalid = statuses?.filter((status) => !MESSAGE_STATUSES.includes(status));
      if (invalid?.length) throw new DomainError('validation', `Status inválido: ${invalid.join(', ')}`);
      const messages = listMessages(deps, { campaignRef: positionals[0], statuses });
      if (messages.length === 0) io.out('Nenhuma mensagem.');
      messages.forEach((message) => io.out(formatMessageRow(message, companyOf(message))));
      return;
    }
    case 'show': {
      const { positionals } = parse(args, {});
      const message = resolveMessage(deps, required(positionals, 0, 'o id da mensagem'));
      formatMessage(message, companyOf(message)).forEach(io.out);
      return;
    }
    case 'edit': {
      const { positionals } = parse(args, {});
      const message = await editInteractively(deps, io, resolveMessage(deps, required(positionals, 0, 'o id da mensagem')));
      io.out(`Mensagem ${message.id} em ${message.status}. Aprove com: message approve ${message.id}`);
      return;
    }
    case 'approve': {
      const { positionals } = parse(args, {});
      if (positionals.length === 0) throw new DomainError('validation', 'Informe o id da mensagem (ou use message review <campanha>)');
      for (const id of positionals) io.out(`Aprovada: ${approveMessage(deps, id).id}`);
      return;
    }
    case 'review': {
      const { positionals } = parse(args, {});
      const drafts = listMessages(deps, { campaignRef: required(positionals, 0, 'a campanha'), statuses: ['draft'] });
      if (drafts.length === 0) return io.out('Nenhum rascunho para revisar.');
      for (const [index, draft] of drafts.entries()) {
        let current = draft;
        for (;;) {
          io.out(`\n===== ${index + 1}/${drafts.length} =====`);
          formatMessage(current, companyOf(current)).forEach(io.out);
          const answer = (await io.prompt('\n[a]provar  [e]ditar  [p]ular  [c]ancelar mensagem  [s]air: ')).trim().toLowerCase();
          if (answer === 'a') {
            approveMessage(deps, current.id);
            io.out('Aprovada.');
            break;
          }
          if (answer === 'e') {
            current = await editInteractively(deps, io, current);
            continue;
          }
          if (answer === 'c') {
            cancelMessage(deps, current.id, (await io.prompt('Motivo: ')).trim() || 'cancelada na revisão');
            break;
          }
          if (answer === 's') return;
          if (answer === 'p') break;
        }
      }
      return;
    }
    case 'cancel': {
      const { values, positionals } = parse(args, { reason: s });
      const reason = str(values, 'reason');
      if (!reason) throw new DomainError('validation', 'Informe --reason');
      io.out(`Cancelada: ${cancelMessage(deps, required(positionals, 0, 'o id da mensagem'), reason).id}`);
      return;
    }
    case 'retry': {
      const { positionals } = parse(args, {});
      io.out(`Mensagem de volta para approved: ${retryFailedMessage(deps, required(positionals, 0, 'o id da mensagem')).id}`);
      return;
    }
    case 'resolve': {
      const { values, positionals } = parse(args, { sent: b, 'not-sent': b, note: s });
      if (values.sent === values['not-sent']) throw new DomainError('validation', 'Use --sent (consta em Enviados) ou --not-sent');
      const message = resolveUnknown(deps, required(positionals, 0, 'o id da mensagem'), values.sent === true, str(values, 'note'));
      io.out(`Mensagem ${message.id}: ${message.status}`);
      return;
    }
    default:
      throw new DomainError('validation', `Subcomando desconhecido: message ${sub ?? ''}`);
  }
};

export const sendCommand = async (deps: Deps, campaignRef: string | undefined, args: string[], io: Io): Promise<void> => {
  const { values } = parse(args, { 'dry-run': b, limit: s, yes: b });
  if (!campaignRef) throw new DomainError('validation', 'Informe a campanha: send <campanha> [--dry-run] [--limit N]');
  const limit = int(str(values, 'limit'), 'limit');
  const companyOf = domainOf(deps);
  const preview = await sendApproved(deps, campaignRef, { dryRun: true, limit });
  const toSend = preview.outcomes.filter((item) => item.outcome === 'would_send').length;
  if (values['dry-run'] || toSend === 0) {
    formatSendReport(preview, companyOf).forEach(io.out);
    return;
  }
  if (deps.email.delivers && !values.yes) {
    io.out(`${toSend} mensagem(ns) aprovada(s) serão ENVIADAS DE VERDADE via ${deps.email.name}.`);
    if ((await io.prompt('Digite ENVIAR para confirmar: ')).trim() !== 'ENVIAR') return io.out('Envio cancelado. Nada foi enviado.');
  }
  formatSendReport(await sendApproved(deps, campaignRef, { limit }), companyOf).forEach(io.out);
};

export const followupCommand = (deps: Deps, sub: string | undefined, args: string[], io: Io): void => {
  const { positionals } = parse(args, {});
  if (sub === 'due') {
    const due = listDueFollowUps(deps, { campaignRef: positionals[0] });
    if (due.length === 0) io.out('Nenhum follow-up vencido.');
    due.forEach((item) => io.out(`${item.company.domain.padEnd(28)} etapa ${item.step}  venceu ${item.dueAt}  ${item.contact.name} <${item.contact.email}>`));
    return;
  }
  if (sub === 'draft') {
    const result = draftDueFollowUps(deps, required(positionals, 0, 'a campanha'));
    io.out(`Rascunhos de follow-up: ${result.drafted.length}. Revise com: message review <campanha>`);
    result.skipped.forEach((item) => io.out(`  - ${item.company}: ${item.reason}`));
    return;
  }
  throw new DomainError('validation', `Subcomando desconhecido: followup ${sub ?? ''}`);
};

export const replyCommand = (deps: Deps, sub: string | undefined, args: string[], io: Io): void => {
  switch (sub) {
    case 'add': {
      const { values, positionals } = parse(args, { category: s, summary: s, date: s, message: s });
      const reply = recordReply(deps, required(positionals, 0, 'o contato (e-mail ou id)'), {
        category: str(values, 'category') as ReplyCategory,
        summary: str(values, 'summary'),
        receivedAt: str(values, 'date'),
        messageId: str(values, 'message'),
      });
      const company = deps.store.companies.findById(reply.companyId)!;
      io.out(`Resposta registrada (${reply.category}) id=${reply.id}. ${company.domain} está em ${company.status}.`);
      if (['interested_to_talk', 'future_collaboration', 'more_info', 'cv_or_portfolio'].includes(reply.category))
        io.out('Se houver interesse real, avance manualmente: company status <domínio> interested');
      return;
    }
    case 'correct': {
      const { values, positionals } = parse(args, { category: s });
      const reply = correctReply(deps, required(positionals, 0, 'o id da resposta'), str(values, 'category') as ReplyCategory);
      io.out(`Classificação: ${reply.category}`);
      return;
    }
    case 'list': {
      const { positionals } = parse(args, {});
      const companyId = positionals[0] ? resolveCompany(deps, positionals[0]).id : undefined;
      const replies = listReplies(deps, { companyId });
      if (replies.length === 0) io.out('Nenhuma resposta.');
      replies.forEach((reply) => {
        const contact = deps.store.contacts.findById(reply.contactId);
        io.out(`${reply.id}  ${reply.receivedAt}  ${reply.category.padEnd(20)} ${contact?.name ?? '?'}${reply.summary ? ` — ${reply.summary}` : ''}`);
      });
      return;
    }
    default:
      throw new DomainError('validation', `Subcomando desconhecido: reply ${sub ?? ''}. Categorias: ${REPLY_CATEGORIES.join(', ')}`);
  }
};

export const suppressCommand = (deps: Deps, sub: string | undefined, args: string[], io: Io): void => {
  const { values, positionals } = parse(args, { reason: s });
  const value = required(positionals, 0, sub === 'domain' ? 'o domínio' : 'o e-mail');
  const reason = str(values, 'reason') ?? '';
  if (sub === 'email') io.out(suppressEmail(deps, value, reason) ? 'E-mail suprimido.' : 'E-mail já estava suprimido.');
  else if (sub === 'domain') io.out(suppressDomain(deps, value, reason) ? 'Domínio suprimido.' : 'Domínio já estava suprimido.');
  else throw new DomainError('validation', `Subcomando desconhecido: suppress ${sub ?? ''}`);
};

export const contactForget = (deps: Deps, args: string[], io: Io): void => {
  const { values, positionals } = parse(args, { reason: s });
  erasePersonalData(deps, required(positionals, 0, 'o contato (e-mail ou id)'), str(values, 'reason') ?? '');
  io.out('Dados pessoais removidos. O endereço continua bloqueado para envios.');
};

export const reportCommand = (deps: Deps, args: string[], io: Io): void => {
  const { values } = parse(args, { campaign: s, from: s, to: s });
  formatReport(buildReport(deps, { campaignRef: str(values, 'campaign'), from: str(values, 'from'), to: str(values, 'to') })).forEach(io.out);
};

