import { DomainError } from '../core/errors.js';
import type { Deps } from '../core/ports/runtime.js';

export type JobTone = 'gn' | 'rd' | 'am' | 'gy';
export type JobLine = { text: string; tone?: JobTone };

export type Job = {
  id: string;
  kind: string;
  label: string;
  status: 'running' | 'done' | 'stopped' | 'failed';
  startedAt: string;
  finishedAt?: string;
  // What the task is doing right now, in the task's own words.
  phase?: string;
  lines: JobLine[];
  // Totals the task wants to show once it ends.
  summary: string[];
  waitingUntil?: string;
  stopRequested: boolean;
  error?: string;
};

export type JobContext = {
  log: (text: string, tone?: JobTone) => void;
  phase: (name: string | undefined) => void;
  waiting: (until: string | undefined) => void;
  summary: (lines: string[]) => void;
  shouldStop: () => boolean;
};

// One background task at a time for the lead and WhatsApp screens, kept in memory so the screens can follow it.
// They share the database and the Google, site and AI quotas, so two tasks side by side would only get in each other's way.
export class Jobs {
  private job: Job | undefined;

  constructor(private readonly deps: Deps) {}

  current(): Job | undefined {
    return this.job;
  }

  start(kind: string, label: string, task: (context: JobContext) => Promise<void>): Job {
    if (this.job?.status === 'running') throw new DomainError('validation', `Já existe uma tarefa em andamento: ${this.job.label}.`);
    const job: Job = { id: this.deps.newId(), kind, label, status: 'running', startedAt: this.deps.clock.now().toISOString(), lines: [], summary: [], stopRequested: false };
    this.job = job;
    const context: JobContext = {
      log: (text, tone) => void job.lines.push({ text, tone }),
      phase: (name) => void (job.phase = name),
      waiting: (until) => void (job.waitingUntil = until),
      summary: (lines) => void (job.summary = lines),
      shouldStop: () => job.stopRequested,
    };
    void task(context)
      .then(() => {
        job.status = job.stopRequested ? 'stopped' : 'done';
      })
      .catch((error: unknown) => {
        job.status = 'failed';
        job.error = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        job.phase = undefined;
        job.waitingUntil = undefined;
        job.finishedAt = this.deps.clock.now().toISOString();
      });
    return job;
  }

  stop(): Job | undefined {
    if (this.job?.status === 'running') this.job.stopRequested = true;
    return this.job;
  }
}
