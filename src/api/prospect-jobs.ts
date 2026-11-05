import type { ProspectRun } from '../core/entities/prospect-run.js';
import { DomainError } from '../core/errors.js';
import type { Deps } from '../core/ports/runtime.js';
import type { QualifyResult } from '../core/use-cases/ai-qualification.js';
import { type ContactsEntry, type DiscoverReport, type FunnelInput, type ProspectEvent, runPending, runProspecting, type RunInput } from '../core/use-cases/prospecting.js';

export type ProspectJobRequest =
  | { mode: 'search'; input: RunInput; label: string }
  | { mode: 'pending' | 'retry'; input: FunnelInput & { limit?: number; domains?: string[] }; label: string };

export type ProspectJob = {
  id: string;
  mode: ProspectJobRequest['mode'];
  label: string;
  status: ProspectRun['status'];
  startedAt: string;
  finishedAt?: string;
  discovered?: DiscoverReport;
  total?: number;
  qualified: QualifyResult[];
  contacts: ContactsEntry[];
  findsContacts: boolean;
  creditCap?: number;
  spentCredits: number;
  stopRequested: boolean;
  error?: string;
};

const toRun = (job: ProspectJob): ProspectRun => {
  const count = (outcome: QualifyResult['outcome']) => job.qualified.filter((item) => item.outcome === outcome).length;
  return {
    id: job.id,
    mode: job.mode,
    label: job.label,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    read: job.qualified.length,
    qualified: count('qualified'),
    review: count('unclear') + count('unreachable'),
    discarded: count('disqualified'),
    creditsSpent: job.spentCredits,
    creditCap: job.creditCap,
    error: job.error,
  };
};

// One prospecting run at a time, kept in memory so the screen can follow it, like SendJobs, and written to
// the history as it goes. Stopping waits for the current company, so no credit buys a dropped result.
export class ProspectJobs {
  private job: ProspectJob | undefined;

  constructor(private readonly deps: Deps) {
    deps.store.prospectRuns.closeAbandoned(deps.clock.now().toISOString());
  }

  current(): ProspectJob | undefined {
    return this.job;
  }

  start(request: ProspectJobRequest): ProspectJob {
    if (this.job?.status === 'running') throw new DomainError('validation', `Já existe uma prospecção em andamento (${this.job.label}).`);
    if (!this.deps.qualifying) throw new DomainError('requirement_missing', 'Qualificação por IA não configurada: defina AWS_BEARER_TOKEN_BEDROCK no .env.');
    if (request.mode === 'search' && !this.deps.prospecting) throw new DomainError('requirement_missing', 'Prospecção automática não configurada: defina HUNTER_API_KEY no .env.');
    const findsContacts = request.input.contacts !== false && !!this.deps.prospecting;
    const job: ProspectJob = {
      id: this.deps.newId(),
      mode: request.mode,
      label: request.label,
      status: 'running',
      startedAt: this.deps.clock.now().toISOString(),
      qualified: [],
      contacts: [],
      findsContacts,
      creditCap: findsContacts ? (request.input.maxCredits ?? 5) : undefined,
      spentCredits: 0,
      stopRequested: false,
    };
    this.job = job;
    this.deps.store.prospectRuns.insert(toRun(job));
    const save = () => this.deps.store.prospectRuns.update(toRun(job));
    const hooks = {
      onEvent: (event: ProspectEvent) => {
        if (event.type === 'discovered') job.discovered = event.report;
        else if (event.type === 'planned') job.total = event.total;
        else if (event.type === 'qualified') job.qualified.push(event.result);
        else {
          job.contacts.push(event.entry);
          job.spentCredits = event.spentCredits;
        }
        save();
      },
      shouldStop: () => job.stopRequested,
    };
    // Without Hunter the pending queue still gets qualified; only the paid step is skipped.
    const input = { ...request.input, contacts: findsContacts };
    const work = request.mode === 'search' ? runProspecting(this.deps, input as RunInput, hooks) : runPending(this.deps, input, hooks);
    void work
      .then(() => {
        job.status = job.stopRequested ? 'stopped' : 'done';
      })
      .catch((error: unknown) => {
        job.status = 'failed';
        job.error = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        job.finishedAt = this.deps.clock.now().toISOString();
        save();
      });
    return job;
  }

  stop(): ProspectJob | undefined {
    if (this.job?.status === 'running') this.job.stopRequested = true;
    return this.job;
  }
}
