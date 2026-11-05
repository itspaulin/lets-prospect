// One prospecting run as the history shows it: counts only, the companies themselves live in the base.
export type ProspectRun = {
  id: string;
  mode: 'search' | 'pending' | 'retry';
  label: string;
  status: 'running' | 'done' | 'stopped' | 'failed';
  startedAt: string;
  finishedAt?: string;
  read: number;
  qualified: number;
  review: number;
  discarded: number;
  creditsSpent: number;
  creditCap?: number;
  error?: string;
};
