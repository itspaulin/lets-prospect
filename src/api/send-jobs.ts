import { DomainError } from '../core/errors.js';
import type { Deps } from '../core/ports/runtime.js';
import { sendApproved, type SendOutcome } from '../core/use-cases/send.js';

export type JobOutcome = {
  messageId: string;
  step: number;
  company: { name: string; domain: string };
  toEmail: string;
  outcome: SendOutcome['outcome'];
  detail?: string;
};

export type SendJob = {
  id: string;
  campaign: string;
  status: 'running' | 'done' | 'stopped' | 'failed';
  startedAt: string;
  finishedAt?: string;
  total: number;
  outcomes: JobOutcome[];
  waitingUntil?: string;
  stopRequested: boolean;
  error?: string;
};

export const compactOutcome = (outcome: SendOutcome): JobOutcome => ({
  messageId: outcome.message.id,
  step: outcome.message.step,
  company: { name: outcome.company.name, domain: outcome.company.domain },
  toEmail: outcome.message.toEmail,
  outcome: outcome.outcome,
  detail: outcome.detail,
});

// One send run at a time, kept in memory so the screen can follow it. The database lock in
// sendApproved still guards against a CLI run happening at the same time.
export class SendJobs {
  private job: SendJob | undefined;

  constructor(private readonly deps: Deps) {}

  current(): SendJob | undefined {
    return this.job;
  }

  async start(campaign: string): Promise<SendJob> {
    if (this.job?.status === 'running') throw new DomainError('validation', `Já existe um envio em andamento (${this.job.campaign}).`);
    const preview = await sendApproved(this.deps, campaign, { dryRun: true });
    const total = preview.outcomes.filter((item) => item.outcome === 'would_send').length;
    if (total === 0) throw new DomainError('validation', 'Nada para enviar agora: nenhuma mensagem aprovada e elegível, ou o limite diário acabou.');
    const job: SendJob = { id: this.deps.newId(), campaign, status: 'running', startedAt: this.deps.clock.now().toISOString(), total, outcomes: [], stopRequested: false };
    this.job = job;
    void sendApproved(this.deps, campaign, {
      onEvent: (event) => {
        if (event.type === 'waiting') job.waitingUntil = event.until;
        else {
          job.waitingUntil = undefined;
          job.outcomes.push(compactOutcome(event.outcome));
        }
      },
      shouldStop: () => job.stopRequested,
    })
      .then(() => {
        job.status = job.stopRequested ? 'stopped' : 'done';
      })
      .catch((error: unknown) => {
        job.status = 'failed';
        job.error = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        job.waitingUntil = undefined;
        job.finishedAt = this.deps.clock.now().toISOString();
      });
    return job;
  }

  stop(): SendJob | undefined {
    if (this.job?.status === 'running') this.job.stopRequested = true;
    return this.job;
  }
}
