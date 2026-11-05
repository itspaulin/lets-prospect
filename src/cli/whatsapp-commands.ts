import { parseArgs } from 'node:util';
import { DomainError } from '../core/errors.js';
import type { Deps } from '../core/ports/runtime.js';
import {
  approveWhatsapp,
  cancelWhatsapp,
  draftWhatsapp,
  editWhatsapp,
  getWhatsapp,
  listWhatsapp,
  resolveUnknownWhatsapp,
  retryWhatsapp,
  runWhatsapp,
  sendWhatsapp,
  suppressPhone,
  type WaMessageView,
  type WaSendOutcome,
} from '../core/use-cases/whatsapp-queue.js';
import type { Io } from './outreach-commands.js';

const int = (raw: string | undefined, flag: string): number | undefined => {
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) throw new DomainError('validation', `--${flag} deve ser inteiro`);
  return parsed;
};

const line = (message: WaMessageView): string => `${message.id.slice(0, 8)}  ${message.status.padEnd(9)} ${message.lead.name}  ${message.toPhone}`;

const outcomeLine = (item: WaSendOutcome): string => `${item.outcome.padEnd(10)} ${item.message.id.slice(0, 8)}  ${item.lead.name}${item.detail ? `  (${item.detail})` : ''}`;

export const whatsappCommand = async (deps: Deps, sub: string | undefined, args: string[], io: Io): Promise<void> => {
  const s = { type: 'string' } as const;
  const b = { type: 'boolean' } as const;
  switch (sub) {
    case 'run': {
      const { values } = parseArgs({ args, options: { 'dry-run': b, limit: s }, strict: true });
      const report = await runWhatsapp(deps, { dryRun: values['dry-run'], limit: int(values.limit, 'limit'), onEvent: (event) => event.type === 'outcome' && io.out(outcomeLine(event.outcome)) });
      if (report.discovered) io.out(report.discovered.searches.length ? `Busca de leads: ${report.discovered.searches.map((item) => `${item.query} (${item.imported} novos)`).join('; ')}.` : `Busca de leads: ${report.discovered.skipped}.`);
      if (report.qualified) io.out(`IA: bons ${report.qualified.results.filter((item) => item.outcome === 'fit').length}, descartados ${report.qualified.results.filter((item) => item.outcome === 'not_a_fit').length}, em dúvida ${report.qualified.results.filter((item) => item.outcome === 'unclear').length}, site não lido ${report.qualified.results.filter((item) => item.outcome === 'unreachable').length}.`);
      if (report.qualifyNote) io.out(`Atenção: ${report.qualifyNote}.`);
      if (report.enriched) io.out(`Sites lidos: WhatsApp achado ${report.enriched.found.length}, celular do Google ${report.enriched.fromListing.length}, sem número ${report.enriched.notFound.length}.`);
      if (report.drafted) io.out(`Mensagens preparadas: ${report.drafted.drafted.length}${deps.whatsapp.autoApprove ? ' (já aprovadas)' : ' (precisam de wa approve)'}.`);
      io.out(`Canal: ${report.sent.channel}${report.sent.delivers ? '' : ' (nada sai da máquina)'}. Restam hoje: ${report.sent.remainingToday}.`);
      if (report.sent.stopped) io.out(`Parou: ${report.sent.stopped}`);
      else if (report.sent.outcomes.length === 0) io.out('Nada para enviar.');
      return;
    }
    case 'draft': {
      const { values } = parseArgs({ args, options: { limit: s }, strict: true });
      const report = draftWhatsapp(deps, { limit: int(values.limit, 'limit') });
      io.out(`Rascunhos criados: ${report.drafted.length}. Pulados: ${report.skipped.length}.`);
      report.drafted.forEach((message) => io.out(`  + ${line(message)}`));
      report.skipped.forEach((item) => io.out(`  - ${item.name}: ${item.reason}`));
      if (report.drafted.length) io.out('Leia cada um (wa show <id>), ajuste se quiser (wa edit <id>) e aprove (wa approve --all).');
      return;
    }
    case 'list': {
      const { values } = parseArgs({ args, options: { status: s }, strict: true });
      const messages = listWhatsapp(deps, values.status?.split(',').map((item) => item.trim()).filter(Boolean));
      if (messages.length === 0) io.out('Nenhuma mensagem.');
      messages.forEach((message) => io.out(line(message)));
      return;
    }
    case 'show': {
      const [ref] = parseArgs({ args, allowPositionals: true, strict: true }).positionals;
      if (!ref) throw new DomainError('validation', 'Informe o id da mensagem');
      const message = getWhatsapp(deps, ref);
      io.out(`${line(message)}${message.error ? `\nErro: ${message.error}` : ''}${message.cancelReason ? `\nCancelada: ${message.cancelReason}` : ''}\n\n${message.body}`);
      return;
    }
    case 'edit': {
      const [ref] = parseArgs({ args, allowPositionals: true, strict: true }).positionals;
      if (!ref) throw new DomainError('validation', 'Informe o id da mensagem');
      const edited = editWhatsapp(deps, ref, await io.edit(getWhatsapp(deps, ref).body));
      io.out(`Editada; voltou para rascunho e precisa de nova aprovação: ${edited.id.slice(0, 8)}`);
      return;
    }
    case 'approve': {
      const { values, positionals } = parseArgs({ args, options: { all: b }, allowPositionals: true, strict: true });
      const approved = approveWhatsapp(deps, values.all ? 'all' : positionals);
      io.out(`Aprovadas: ${approved.length}`);
      return;
    }
    case 'retry': {
      const [ref] = parseArgs({ args, allowPositionals: true, strict: true }).positionals;
      if (!ref) throw new DomainError('validation', 'Informe o id da mensagem');
      io.out(`De volta à fila: ${retryWhatsapp(deps, ref).id.slice(0, 8)}`);
      return;
    }
    case 'cancel': {
      const { values, positionals } = parseArgs({ args, options: { reason: s }, allowPositionals: true, strict: true });
      if (!positionals[0]) throw new DomainError('validation', 'Informe o id da mensagem');
      io.out(`Cancelada: ${cancelWhatsapp(deps, positionals[0], values.reason ?? '').id.slice(0, 8)}`);
      return;
    }
    case 'send': {
      const { values } = parseArgs({ args, options: { 'dry-run': b, limit: s }, strict: true });
      const report = await sendWhatsapp(deps, { dryRun: values['dry-run'], limit: int(values.limit, 'limit'), onEvent: (event) => event.type === 'outcome' && io.out(outcomeLine(event.outcome)) });
      io.out(`Canal: ${report.channel}${report.delivers ? '' : ' (nada sai da máquina)'}. Restam hoje: ${report.remainingToday}.`);
      if (report.stopped) io.out(`Parou: ${report.stopped}`);
      else if (report.outcomes.length === 0) io.out('Nada aprovado para enviar.');
      return;
    }
    case 'resolve': {
      const { values, positionals } = parseArgs({ args, options: { sent: b, 'not-sent': b }, allowPositionals: true, strict: true });
      if (!positionals[0] || values.sent === values['not-sent']) throw new DomainError('validation', 'Use: wa resolve <id> --sent | --not-sent');
      io.out(`Conciliada: ${resolveUnknownWhatsapp(deps, positionals[0], Boolean(values.sent)).status}`);
      return;
    }
    case 'suppress': {
      const { values, positionals } = parseArgs({ args, options: { reason: s }, allowPositionals: true, strict: true });
      if (!positionals[0]) throw new DomainError('validation', 'Informe o telefone');
      io.out(suppressPhone(deps, positionals[0], values.reason ?? '') ? 'Telefone suprimido; o lead não será mais contatado.' : 'Telefone já estava suprimido.');
      return;
    }
    default:
      throw new DomainError('validation', `Subcomando desconhecido: wa ${sub ?? ''}`);
  }
};
