import type { Company } from '../entities/company.js';
import type { Message, SendAttempt } from '../entities/outreach.js';
import { DomainError } from '../errors.js';
import type { SendResult } from '../ports/email.js';
import type { Deps } from '../ports/runtime.js';
import { assertTransition } from '../rules/company-status.js';
import { checkEligibility } from '../rules/eligibility.js';
import { REPLY_EFFECTS } from '../rules/replies.js';
import { cancelInTransaction, resolveMessage } from './messages.js';
import { syncOptOuts } from './optouts.js';
import { followUpDueAt, isSuppressed, resolveCampaign } from './outreach-shared.js';
import { nowIso, record, today } from './shared.js';

export type SendOutcome = { message: Message; company: Company; outcome: 'sent' | 'failed' | 'unknown' | 'cancelled' | 'skipped' | 'would_send'; detail?: string };
export type SendReport = { outcomes: SendOutcome[]; remainingToday: number; transport: string; delivers: boolean };

const LOCK = 'send';
const LOCK_STALE_MS = 30 * 60_000;

export const hasStoppingReply = (deps: Deps, companyId: string): boolean =>
  deps.store.replies.list({ companyId }).some((reply) => REPLY_EFFECTS[reply.category].stopsSequence);

// A follow-up goes out as a reply in the same conversation: In-Reply-To names the previous e-mail and References the whole chain,
// so the recipient's mail client groups them and the "Re:" in the subject is true.
// One-click opt-out (RFC 8058) when the link exists, so Gmail shows its own "unsubscribe" button; mailto otherwise.
const unsubscribeHeaders = (deps: Deps, toEmail: string): Record<string, string> => {
  const url = deps.unsubscribe?.url(toEmail);
  const mailto = `<mailto:${deps.sender.email}?subject=unsubscribe>`;
  return url ? { 'List-Unsubscribe': `<${url}>, ${mailto}`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : { 'List-Unsubscribe': mailto };
};

const threadHeaders = (deps: Deps, message: Message): Record<string, string> => {
  const chain: string[] = [];
  for (let step = 0; step < message.step; step++) {
    const earlier = deps.store.messages.find(message.campaignId, message.contactId, step);
    if (earlier && earlier.status === 'sent') chain.push(earlier.headerMessageId);
  }
  return chain.length ? { 'In-Reply-To': chain[chain.length - 1]!, References: chain.join(' ') } : {};
};

const eligibilityFor = (deps: Deps, message: Message) => {
  const campaign = deps.store.campaigns.findById(message.campaignId)!;
  const company = deps.store.companies.findById(message.companyId)!;
  const contact = deps.store.contacts.findById(message.contactId);
  const previous = message.step > 0 ? deps.store.messages.find(message.campaignId, message.contactId, message.step - 1) : null;
  return {
    company,
    result: checkEligibility({
      message,
      campaign,
      company,
      contact,
      suppressed: contact?.email ? isSuppressed(deps, contact.email) : false,
      hasReply: hasStoppingReply(deps, company.id),
      previousStepSent: message.step === 0 || previous?.status === 'sent',
    }),
  };
};

// After a confirmed send: first contact moves the company to contacted and schedules the next follow-up.
export const applySent = (deps: Deps, message: Message, sentAt: string, providerMessageId?: string): Message => {
  const sent: Message = { ...message, status: 'sent', sentAt, providerMessageId, error: undefined, updatedAt: nowIso(deps) };
  deps.store.messages.update(sent);
  const company = deps.store.companies.findById(message.companyId)!;
  const hasNext = message.step < deps.sending.followUp.maxFollowUps;
  const nextAt = followUpDueAt(deps, { ...sent, sentAt });
  let updated: Company = {
    ...company,
    nextActionAt: nextAt,
    nextActionNote: hasNext ? `follow-up ${message.step + 1} se não houver resposta` : 'sem resposta: avaliar encerramento (inactive)',
    updatedAt: nowIso(deps),
  };
  if (message.step === 0 && company.status === 'qualified') {
    assertTransition('qualified', 'contacted');
    updated = { ...updated, status: 'contacted' };
    record(deps, { companyId: company.id, type: 'status_changed', summary: 'qualified -> contacted: primeiro envio confirmado', data: { from: 'qualified', to: 'contacted', messageId: message.id } });
  }
  deps.store.companies.update(updated);
  record(deps, {
    companyId: company.id,
    contactId: message.contactId,
    type: 'message_sent',
    summary: `Enviada etapa ${message.step}: "${message.subject}"`,
    data: { messageId: message.id, providerMessageId, headerMessageId: message.headerMessageId },
  });
  return sent;
};

const finishAttempt = (deps: Deps, attempt: SendAttempt, message: Message, result: SendResult): Message =>
  deps.store.transaction(() => {
    const finishedAt = nowIso(deps);
    if (result.status === 'sent') {
      deps.store.attempts.update({ ...attempt, finishedAt, outcome: 'sent', providerMessageId: result.providerMessageId });
      return applySent(deps, message, finishedAt, result.providerMessageId);
    }
    deps.store.attempts.update({ ...attempt, finishedAt, outcome: result.status, error: result.error });
    const updated: Message = { ...message, status: result.status, error: result.error, updatedAt: finishedAt };
    deps.store.messages.update(updated);
    record(deps, {
      companyId: message.companyId,
      contactId: message.contactId,
      type: result.status === 'failed' ? 'message_failed' : 'message_unknown',
      summary:
        result.status === 'failed'
          ? `Falha no envio da etapa ${message.step}: ${result.error}`
          : `Envio da etapa ${message.step} sem confirmação: ${result.error}. Conferir a pasta de enviados e usar "message resolve".`,
      data: { messageId: message.id },
    });
    return updated;
  });

// A message left in "sending" means a previous run died mid-send. It may have gone out, so it becomes
// "unknown" for manual reconciliation instead of being sent again.
const recoverInterrupted = (deps: Deps): Message[] =>
  deps.store.transaction(() =>
    deps.store.messages.list({ statuses: ['sending'] }).map((message) => {
      const now = nowIso(deps);
      for (const attempt of deps.store.attempts.listByMessage(message.id).filter((item) => item.outcome === 'sending'))
        deps.store.attempts.update({ ...attempt, outcome: 'unknown', finishedAt: now, error: 'execução interrompida durante o envio' });
      const updated: Message = { ...message, status: 'unknown', error: 'execução interrompida durante o envio', updatedAt: now };
      deps.store.messages.update(updated);
      record(deps, { companyId: message.companyId, contactId: message.contactId, type: 'message_unknown', summary: `Envio da etapa ${message.step} interrompido; conferir manualmente`, data: { messageId: message.id } });
      return updated;
    }),
  );

export type SendEvent = { type: 'outcome'; outcome: SendOutcome } | { type: 'waiting'; until: string };

export type SendOptions = {
  dryRun?: boolean;
  limit?: number;
  // Lets an interface follow the run and stop it between messages. Stopping never interrupts a
  // message already handed to the provider.
  onEvent?: (event: SendEvent) => void;
  shouldStop?: () => boolean;
};

export const sendApproved = async (deps: Deps, campaignRef: string, options: SendOptions = {}): Promise<SendReport> => {
  const campaign = resolveCampaign(deps, campaignRef);
  const owner = deps.newId();
  const lockNow = nowIso(deps);
  if (!options.dryRun && !deps.store.locks.acquire(LOCK, owner, lockNow, new Date(deps.clock.now().getTime() - LOCK_STALE_MS).toISOString()))
    throw new DomainError('validation', 'Já existe um envio em andamento. Aguarde ou tente de novo em 30 minutos.');
  try {
    if (!options.dryRun) {
      recoverInterrupted(deps);
      await syncOptOuts(deps);
    }
    const sentToday = deps.store.attempts.countStartedSince(`${today(deps)}T00:00:00.000Z`);
    let remaining = Math.max(0, deps.sending.dailyLimit - sentToday);
    if (options.limit !== undefined) remaining = Math.min(remaining, options.limit);
    const outcomes: SendOutcome[] = [];
    const push = (outcome: SendOutcome) => {
      outcomes.push(outcome);
      options.onEvent?.({ type: 'outcome', outcome });
    };
    let first = true;

    for (const queued of deps.store.messages.list({ campaignId: campaign.id, statuses: ['approved'] })) {
      if (!options.dryRun && options.shouldStop?.()) break;
      const { company, result } = eligibilityFor(deps, queued);
      if (!result.ok) {
        if (result.permanent && !options.dryRun) deps.store.transaction(() => cancelInTransaction(deps, queued, result.reason));
        push({ message: queued, company, outcome: result.permanent && !options.dryRun ? 'cancelled' : 'skipped', detail: result.reason });
        continue;
      }
      if (remaining <= 0) {
        push({ message: queued, company, outcome: 'skipped', detail: 'limite diário atingido' });
        continue;
      }
      if (options.dryRun) {
        push({ message: queued, company, outcome: 'would_send' });
        remaining--;
        continue;
      }

      if (!first && deps.sending.minIntervalSeconds > 0) {
        options.onEvent?.({ type: 'waiting', until: new Date(deps.clock.now().getTime() + deps.sending.minIntervalSeconds * 1000).toISOString() });
        await deps.sleep(deps.sending.minIntervalSeconds * 1000);
        if (options.shouldStop?.()) break;
      }
      first = false;

      const claimed = deps.store.transaction(() => {
        if (!deps.store.messages.claim(queued.id, nowIso(deps))) return null;
        const attempt: SendAttempt = { id: deps.newId(), messageId: queued.id, campaignId: campaign.id, startedAt: nowIso(deps), outcome: 'sending' };
        deps.store.attempts.insert(attempt);
        return attempt;
      });
      if (!claimed) {
        push({ message: queued, company, outcome: 'skipped', detail: 'mensagem mudou de estado durante o envio' });
        continue;
      }
      remaining--;

      let sendResult: SendResult;
      try {
        sendResult = await deps.email.send({
          from: { name: deps.sender.name, email: deps.sender.email },
          to: queued.toEmail,
          subject: queued.subject,
          text: queued.body,
          headerMessageId: queued.headerMessageId,
          headers: { ...unsubscribeHeaders(deps, queued.toEmail), ...threadHeaders(deps, queued) },
        });
      } catch (error) {
        sendResult = { status: 'unknown', error: error instanceof Error ? error.message : String(error) };
      }
      const finished = finishAttempt(deps, claimed, { ...queued, status: 'sending' }, sendResult);
      push({ message: finished, company, outcome: sendResult.status, detail: 'error' in sendResult ? sendResult.error : undefined });
    }
    return { outcomes, remainingToday: remaining, transport: deps.email.name, delivers: deps.email.delivers };
  } finally {
    if (!options.dryRun) deps.store.locks.release(LOCK, owner);
  }
};

export const resolveUnknown = (deps: Deps, id: string, wasSent: boolean, note?: string): Message =>
  deps.store.transaction(() => {
    const message = resolveMessage(deps, id);
    if (message.status !== 'unknown') throw new DomainError('invalid_transition', `Mensagem está ${message.status}; só unknown é conciliada`);
    record(deps, {
      companyId: message.companyId,
      contactId: message.contactId,
      type: 'message_resolved',
      summary: `Conciliação manual: ${wasSent ? 'mensagem consta como enviada' : 'mensagem não foi enviada'}${note ? ` (${note})` : ''}`,
      data: { messageId: id },
    });
    if (wasSent) return applySent(deps, message, nowIso(deps), message.providerMessageId);
    const updated: Message = { ...message, status: 'approved', updatedAt: nowIso(deps) };
    deps.store.messages.update(updated);
    return updated;
  });
