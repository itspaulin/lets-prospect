import { z } from 'zod';
import type { Lead } from '../entities/lead.js';
import type { WaMessage, WaMessageStatus } from '../entities/whatsapp.js';
import { WA_MESSAGE_STATUSES } from '../entities/whatsapp.js';
import { DomainError } from '../errors.js';
import type { Deps } from '../ports/runtime.js';
import type { WhatsappSendResult } from '../ports/whatsapp.js';
import { normalizeBrazilPhone } from '../rules/phone.js';
import { hashValue } from '../rules/render.js';
import { inSendWindow, localDayStart } from '../rules/send-window.js';
import { assertWhatsappPlaceholders, renderWhatsapp } from '../rules/whatsapp-message.js';
import { discoverNextLeads, enrichLeads, qualifyLeads, type AutoDiscoverReport, type EnrichLeadsReport, type QualifyLeadsReport } from './leads.js';
import { nowIso, parseInput } from './shared.js';

const LOCK = 'send-whatsapp';
const LOCK_STALE_MS = 30 * 60_000;
const MAX_BODY = 1000;

export const isPhoneSuppressed = (deps: Deps, phone: string): boolean => deps.store.suppressions.has('phone', hashValue(phone));

const bodySchema = z.string().trim().min(1, 'a mensagem não pode ficar vazia').max(MAX_BODY, `a mensagem passa de ${MAX_BODY} caracteres`);

// A reference is a full id or the first characters of one, as long as only one message matches.
export const resolveWaMessage = (deps: Deps, ref: string): WaMessage => {
  const exact = deps.store.waMessages.findById(ref);
  if (exact) return exact;
  const matches = ref.length >= 4 ? deps.store.waMessages.list().filter((message) => message.id.startsWith(ref)) : [];
  if (matches.length === 1) return matches[0]!;
  throw new DomainError(matches.length > 1 ? 'validation' : 'not_found', matches.length > 1 ? `Referência ambígua: ${ref}` : `Mensagem não encontrada: ${ref}`);
};

export type WaMessageView = WaMessage & { lead: Lead };

const withLead = (deps: Deps, message: WaMessage): WaMessageView => ({ ...message, lead: deps.store.leads.findById(message.leadId)! });

export const listWhatsapp = (deps: Deps, statuses?: string[]): WaMessageView[] => {
  const invalid = statuses?.find((status) => !(WA_MESSAGE_STATUSES as readonly string[]).includes(status));
  if (invalid) throw new DomainError('validation', `Status inválido: ${invalid}. Use: ${WA_MESSAGE_STATUSES.join(', ')}`);
  return deps.store.waMessages.list({ statuses: statuses as WaMessageStatus[] | undefined }).map((message) => withLead(deps, message));
};

export const getWhatsapp = (deps: Deps, ref: string): WaMessageView => withLead(deps, resolveWaMessage(deps, ref));

const draftSchema = z.object({ limit: z.number().int().min(1).max(200).default(50) });

export type DraftReport = { drafted: WaMessageView[]; skipped: { name: string; reason: string }[] };

// Drafts only: nothing is sent until each message is read and approved. Leads that already have a message,
// have no WhatsApp number yet or are on the suppression list are left out.
export const draftWhatsapp = (deps: Deps, input: z.input<typeof draftSchema> = {}): DraftReport => {
  const data = parseInput(draftSchema, input);
  assertWhatsappPlaceholders(deps.whatsapp.firstMessage);
  const report: DraftReport = { drafted: [], skipped: [] };
  for (const lead of deps.store.leads.list({ statuses: ['identified'] })) {
    if (report.drafted.length >= data.limit) break;
    if (deps.store.waMessages.findByLead(lead.id)) continue;
    if (!lead.whatsapp) {
      report.skipped.push({ name: lead.name, reason: lead.enrichedAt ? (lead.enrichmentNote ?? 'sem WhatsApp') : 'ainda sem leitura do site (rode lead enrich)' });
      continue;
    }
    // Nobody is contacted before the AI has judged the site and found it a fit.
    if (lead.qualification?.verdict !== 'fit') {
      report.skipped.push({ name: lead.name, reason: lead.qualification ? `IA: ${lead.qualification.verdict === 'not_a_fit' ? 'não é um bom perfil' : 'dúvida, precisa de revisão'}. ${lead.qualification.reason}` : 'ainda não qualificado pela IA (rode lead qualify)' });
      continue;
    }
    if (isPhoneSuppressed(deps, lead.whatsapp) || isPhoneSuppressed(deps, lead.phone)) {
      report.skipped.push({ name: lead.name, reason: 'na lista de supressão' });
      continue;
    }
    const now = nowIso(deps);
    const body = renderWhatsapp(deps.whatsapp.firstMessage, { lead, sender: deps.sender });
    const message: WaMessage = {
      id: deps.newId(),
      leadId: lead.id,
      toPhone: lead.whatsapp,
      body,
      ...(deps.whatsapp.autoApprove ? { status: 'approved', contentHash: hashValue(body), approvedAt: now } : { status: 'draft' }),
      createdAt: now,
      updatedAt: now,
    };
    deps.store.waMessages.insert(message);
    report.drafted.push({ ...message, lead });
  }
  return report;
};

export const editWhatsapp = (deps: Deps, ref: string, body: string): WaMessage => {
  const text = parseInput(bodySchema, body);
  const message = resolveWaMessage(deps, ref);
  if (!['draft', 'approved'].includes(message.status)) throw new DomainError('invalid_transition', `Mensagem está ${message.status}; só rascunho ou aprovada pode ser editada`);
  // Any edit voids the approval: the text that goes out is always the text someone approved.
  const updated: WaMessage = { ...message, body: text, status: 'draft', contentHash: undefined, approvedAt: undefined, updatedAt: nowIso(deps) };
  deps.store.waMessages.update(updated);
  return updated;
};

export const approveWhatsapp = (deps: Deps, refs: string[] | 'all'): WaMessage[] =>
  deps.store.transaction(() => {
    const targets = refs === 'all' ? deps.store.waMessages.list({ statuses: ['draft'] }) : refs.map((ref) => resolveWaMessage(deps, ref));
    if (targets.length === 0) throw new DomainError('validation', 'Nenhum rascunho para aprovar');
    return targets.map((message) => {
      if (message.status !== 'draft') throw new DomainError('invalid_transition', `Mensagem ${message.id.slice(0, 8)} está ${message.status}; só rascunho é aprovado`);
      const lead = deps.store.leads.findById(message.leadId);
      if (!lead || lead.whatsapp !== message.toPhone) throw new DomainError('validation', `O número do lead mudou desde o rascunho (${message.id.slice(0, 8)}); gere um novo rascunho`);
      const now = nowIso(deps);
      const approved: WaMessage = { ...message, status: 'approved', contentHash: hashValue(message.body), approvedAt: now, updatedAt: now };
      deps.store.waMessages.update(approved);
      return approved;
    });
  });

const cancelInTransaction = (deps: Deps, message: WaMessage, reason: string): WaMessage => {
  const cancelled: WaMessage = { ...message, status: 'cancelled', cancelReason: reason, updatedAt: nowIso(deps) };
  deps.store.waMessages.update(cancelled);
  return cancelled;
};

export const cancelWhatsapp = (deps: Deps, ref: string, reason: string): WaMessage => {
  if (!reason.trim()) throw new DomainError('validation', 'Informe o motivo');
  return deps.store.transaction(() => {
    const message = resolveWaMessage(deps, ref);
    if (!['draft', 'approved', 'failed'].includes(message.status)) throw new DomainError('invalid_transition', `Mensagem está ${message.status}; não dá para cancelar`);
    return cancelInTransaction(deps, message, reason.trim());
  });
};

export const retryWhatsapp = (deps: Deps, ref: string): WaMessage => {
  const message = resolveWaMessage(deps, ref);
  if (message.status !== 'failed') throw new DomainError('invalid_transition', `Mensagem está ${message.status}; só failed pode ser reenviada`);
  const updated: WaMessage = { ...message, status: 'approved', error: undefined, updatedAt: nowIso(deps) };
  deps.store.waMessages.update(updated);
  return updated;
};

// The number is stored as a hash, so it stays blocked even if the lead is erased. Pending messages to it are cancelled.
export const suppressPhone = (deps: Deps, rawPhone: string, reason: string): boolean => {
  if (!reason.trim()) throw new DomainError('validation', 'Informe --reason');
  const phone = normalizeBrazilPhone(rawPhone);
  if (!phone) throw new DomainError('validation', `Telefone inválido: "${rawPhone}"`);
  return deps.store.transaction(() => {
    const inserted = deps.store.suppressions.insert({ id: deps.newId(), kind: 'phone', valueHash: hashValue(phone.e164), reason: reason.trim(), createdAt: nowIso(deps) });
    for (const lead of deps.store.leads.list().filter((item) => item.phone === phone.e164 || item.whatsapp === phone.e164)) {
      if (lead.status !== 'do_not_contact') deps.store.leads.update({ ...lead, status: 'do_not_contact', updatedAt: nowIso(deps) });
      const message = deps.store.waMessages.findByLead(lead.id);
      if (message && ['draft', 'approved'].includes(message.status)) cancelInTransaction(deps, message, 'número na lista de supressão');
    }
    return inserted;
  });
};

export type WaSendOutcome = { message: WaMessage; lead: Lead; outcome: 'sent' | 'failed' | 'unknown' | 'cancelled' | 'skipped' | 'would_send'; detail?: string };
export type WaSendReport = {
  outcomes: WaSendOutcome[];
  remainingToday: number;
  channel: string;
  delivers: boolean;
  // Why the run ended before the queue did, when it did.
  stopped?: string;
};

export type WaSendEvent = { type: 'outcome'; outcome: WaSendOutcome } | { type: 'waiting'; until: string };

export type WaSendOptions = {
  dryRun?: boolean;
  limit?: number;
  onEvent?: (event: WaSendEvent) => void;
  shouldStop?: () => boolean;
};

const blockReason = (deps: Deps, message: WaMessage, lead: Lead | null): { reason: string; permanent: boolean } | undefined => {
  if (!lead) return { reason: 'lead não encontrado', permanent: true };
  if (lead.status !== 'identified') return { reason: `lead já está ${lead.status}`, permanent: true };
  if (lead.whatsapp !== message.toPhone) return { reason: 'o número do lead mudou depois da aprovação', permanent: true };
  if (isPhoneSuppressed(deps, message.toPhone) || isPhoneSuppressed(deps, lead.phone)) return { reason: 'na lista de supressão', permanent: true };
  if (!message.contentHash || hashValue(message.body) !== message.contentHash) return { reason: 'conteúdo alterado depois da aprovação', permanent: false };
  return undefined;
};

// A message left in "sending" means a previous run died mid-send. It may have gone out, so it becomes
// "unknown" for manual reconciliation instead of being sent again.
const recoverInterrupted = (deps: Deps): void =>
  deps.store.transaction(() => {
    for (const message of deps.store.waMessages.list({ statuses: ['sending'] }))
      deps.store.waMessages.update({ ...message, status: 'unknown', error: 'execução interrompida durante o envio', updatedAt: nowIso(deps) });
  });

const finish = (deps: Deps, message: WaMessage, result: WhatsappSendResult): WaMessage =>
  deps.store.transaction(() => {
    const now = nowIso(deps);
    if (result.status === 'sent') {
      const sent: WaMessage = { ...message, status: 'sent', sentAt: now, providerMessageId: result.providerMessageId, error: undefined, updatedAt: now };
      deps.store.waMessages.update(sent);
      const lead = deps.store.leads.findById(message.leadId)!;
      deps.store.leads.update({ ...lead, status: 'contacted', updatedAt: now });
      return sent;
    }
    const status = result.status === 'unknown' ? 'unknown' : 'failed';
    const updated: WaMessage = { ...message, status, error: result.error, updatedAt: now };
    deps.store.waMessages.update(updated);
    return updated;
  });

export const sendWhatsapp = async (deps: Deps, options: WaSendOptions = {}): Promise<WaSendReport> => {
  const { whatsapp: config, whatsappChannel: channel } = deps;
  const base = { channel: channel.name, delivers: channel.delivers };
  const owner = deps.newId();
  if (!options.dryRun && !deps.store.locks.acquire(LOCK, owner, nowIso(deps), new Date(deps.clock.now().getTime() - LOCK_STALE_MS).toISOString()))
    throw new DomainError('validation', 'Já existe um envio de WhatsApp em andamento. Aguarde ou tente de novo em 30 minutos.');
  try {
    if (!options.dryRun) recoverInterrupted(deps);
    const outsideWindow = !inSendWindow(deps.clock.now(), config.window);
    if (outsideWindow && !options.dryRun) {
      const { startHour, endHour, timezone } = config.window;
      return { outcomes: [], remainingToday: 0, ...base, stopped: `fora do horário de envio (dias ${config.window.days.join(',')}, ${startHour}h às ${endHour}h, ${timezone})` };
    }
    const sentToday = deps.store.waMessages.countStartedSince(localDayStart(deps.clock.now(), config.window.timezone).toISOString());
    let remaining = Math.max(0, config.dailyLimit - sentToday);
    if (options.limit !== undefined) remaining = Math.min(remaining, options.limit);
    const outcomes: WaSendOutcome[] = [];
    const push = (outcome: WaSendOutcome) => {
      outcomes.push(outcome);
      options.onEvent?.({ type: 'outcome', outcome });
    };
    let first = true;
    let failuresInARow = 0;
    let stopped: string | undefined = outsideWindow ? 'fora do horário de envio: hoje não enviaria nada agora' : undefined;

    for (const queued of deps.store.waMessages.list({ statuses: ['approved'] })) {
      if (!options.dryRun && options.shouldStop?.()) break;
      const lead = deps.store.leads.findById(queued.leadId);
      const blocked = blockReason(deps, queued, lead);
      if (blocked) {
        const cancel = blocked.permanent && !options.dryRun;
        const message = cancel ? deps.store.transaction(() => cancelInTransaction(deps, queued, blocked.reason)) : queued;
        push({ message, lead: lead!, outcome: cancel ? 'cancelled' : 'skipped', detail: blocked.reason });
        continue;
      }
      if (remaining <= 0) {
        push({ message: queued, lead: lead!, outcome: 'skipped', detail: 'limite diário atingido' });
        continue;
      }
      if (options.dryRun) {
        push({ message: queued, lead: lead!, outcome: 'would_send' });
        remaining--;
        continue;
      }

      if (!first && config.maxIntervalSeconds > 0) {
        const seconds = config.minIntervalSeconds + (config.maxIntervalSeconds - config.minIntervalSeconds) * deps.random();
        options.onEvent?.({ type: 'waiting', until: new Date(deps.clock.now().getTime() + seconds * 1000).toISOString() });
        await deps.sleep(seconds * 1000);
        if (options.shouldStop?.()) break;
        // A long run can drift past closing time while it waits between messages.
        if (!inSendWindow(deps.clock.now(), config.window)) {
          stopped = 'saiu do horário de envio; o restante fica para o próximo dia útil';
          break;
        }
      }
      first = false;

      const startedAt = nowIso(deps);
      if (!deps.store.waMessages.claim(queued.id, startedAt)) {
        push({ message: queued, lead: lead!, outcome: 'skipped', detail: 'mensagem mudou de estado durante o envio' });
        continue;
      }
      remaining--;

      let result: WhatsappSendResult;
      try {
        result = await channel.send({ to: queued.toPhone, body: queued.body, messageId: queued.id });
      } catch (error) {
        result = { status: 'unknown', error: error instanceof Error ? error.message : String(error) };
      }
      const finished = finish(deps, { ...queued, status: 'sending', startedAt }, result);
      const detail = 'error' in result ? result.error : undefined;
      push({ message: finished, lead: lead!, outcome: finished.status === 'sent' ? 'sent' : finished.status === 'unknown' ? 'unknown' : 'failed', detail });

      if (result.status === 'blocked') {
        stopped = `conta bloqueada ou restrita pelo WhatsApp: ${result.error}. Pare e investigue antes de continuar.`;
        break;
      }
      failuresInARow = result.status === 'sent' ? 0 : failuresInARow + 1;
      if (failuresInARow >= config.stopAfterFailures) {
        stopped = `parou depois de ${failuresInARow} falhas seguidas; veja o motivo antes de continuar`;
        break;
      }
    }
    return { outcomes, remainingToday: remaining, ...base, stopped };
  } finally {
    if (!options.dryRun) deps.store.locks.release(LOCK, owner);
  }
};

export const resolveUnknownWhatsapp = (deps: Deps, ref: string, wasSent: boolean): WaMessage =>
  deps.store.transaction(() => {
    const message = resolveWaMessage(deps, ref);
    if (message.status !== 'unknown') throw new DomainError('invalid_transition', `Mensagem está ${message.status}; só unknown é conciliada`);
    const now = nowIso(deps);
    if (!wasSent) {
      const back: WaMessage = { ...message, status: 'approved', error: undefined, updatedAt: now };
      deps.store.waMessages.update(back);
      return back;
    }
    const sent: WaMessage = { ...message, status: 'sent', sentAt: now, error: undefined, updatedAt: now };
    deps.store.waMessages.update(sent);
    const lead = deps.store.leads.findById(message.leadId);
    if (lead && lead.status === 'identified') deps.store.leads.update({ ...lead, status: 'contacted', updatedAt: now });
    return sent;
  });

export type RunPhase = 'discovering' | 'reading_sites' | 'qualifying' | 'drafting' | 'sending';
export type RunWhatsappOptions = WaSendOptions & { enrichLimit?: number; draftLimit?: number; onPhase?: (phase: RunPhase) => void };
export type RunWhatsappReport = { discovered?: AutoDiscoverReport; enriched?: EnrichLeadsReport; qualified?: QualifyLeadsReport; qualifyNote?: string; drafted?: DraftReport; sent: WaSendReport };

// The whole routine in one go, for a scheduler to call: top up the pool of leads when it runs low, read the sites,
// let the AI judge each lead, draft the first message for the ones it approved (already approved when autoApprove
// is on), then send what the limit, window and pacing allow. A dry run only previews the sending.
export const runWhatsapp = async (deps: Deps, options: RunWhatsappOptions = {}): Promise<RunWhatsappReport> => {
  const { enrichLimit, draftLimit, onPhase, ...sendOptions } = options;
  if (options.dryRun) return { sent: await sendWhatsapp(deps, sendOptions) };
  const interrupted = (): RunWhatsappReport => ({ sent: { outcomes: [], remainingToday: 0, channel: deps.whatsappChannel.name, delivers: deps.whatsappChannel.delivers, stopped: 'interrompido a pedido' } });
  const report: Omit<RunWhatsappReport, 'sent'> = {};
  const step = async <T,>(phase: RunPhase, work: () => Promise<T> | T): Promise<T | undefined> => {
    if (options.shouldStop?.()) return undefined;
    onPhase?.(phase);
    return work();
  };
  report.discovered = await step('discovering', () => discoverNextLeads(deps));
  report.enriched = deps.pages ? await step('reading_sites', () => enrichLeads(deps, { limit: enrichLimit }, { shouldStop: options.shouldStop })) : undefined;
  const canQualify = !!deps.leadQualifier && !!deps.qualifying;
  report.qualified = canQualify ? await step('qualifying', () => qualifyLeads(deps, {}, { shouldStop: options.shouldStop })) : undefined;
  report.qualifyNote = canQualify ? undefined : 'qualificação por IA não configurada: ninguém é contatado sem ela';
  report.drafted = await step('drafting', () => draftWhatsapp(deps, { limit: draftLimit }));
  if (options.shouldStop?.()) return { ...report, ...interrupted() };
  onPhase?.('sending');
  return { ...report, sent: await sendWhatsapp(deps, sendOptions) };
};
