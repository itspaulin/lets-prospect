import { useCallback, useEffect, useRef, useState } from 'react';
import { type Job, type JobKind, jobApi, api } from '../api';
import { brDateTime } from '../format';
import { Chip, ErrorBox, useToast } from './ui';

const TONE_LABEL = { gn: 'ok', rd: 'erro', am: 'atenção', gy: 'info' } as const;

// Follows the one background task of the lead and WhatsApp screens. It picks up a task that was already running when the
// screen opened, polls while it runs and calls onFinished once when it ends, so the screen can reload its data.
export const useJob = (kinds: JobKind[], onFinished: () => void) => {
  const toast = useToast();
  const [job, setJob] = useState<Job | null>(null);
  const finished = useRef(onFinished);
  finished.current = onFinished;
  const wasRunning = useRef(false);
  const mine = (candidate: Job | null) => (candidate && (kinds as string[]).includes(candidate.kind) ? candidate : null);

  useEffect(() => {
    void api.get<Job | null>('/api/job').then((current) => setJob(mine(current))).catch(() => undefined);
  }, []);

  useEffect(() => {
    const running = job?.status === 'running';
    if (wasRunning.current && !running) finished.current();
    wasRunning.current = running;
    if (!running) return;
    const id = window.setInterval(async () => {
      try {
        setJob(mine(await api.get<Job | null>('/api/job')));
      } catch {
        /* keep polling */
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [job?.status]);

  const start = useCallback(
    async (kind: JobKind, confirm?: string) => {
      try {
        setJob(await jobApi.start(kind, confirm));
      } catch (error) {
        toast((error as Error).message, 'rd');
      }
    },
    [toast],
  );
  const stop = useCallback(async () => setJob(mine(await jobApi.stop()) ?? job), [job]);
  return { job, start, stop, running: job?.status === 'running' };
};

export const JobPanel = ({ job, onStop, onClose }: { job: Job; onStop: () => void; onClose: () => void }) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (job.status !== 'running') return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [job.status]);
  const wait = job.waitingUntil ? Math.max(0, Math.ceil((Date.parse(job.waitingUntil) - now) / 1000)) : 0;
  const title = job.status === 'running' ? (job.stopRequested ? 'Interrompendo após o passo atual…' : job.label) : job.status === 'stopped' ? `${job.label}: interrompida` : job.status === 'failed' ? `${job.label}: falhou` : `${job.label}: concluída`;

  return (
    <section className="cd" data-tour="job-panel">
      <div className="cdh">
        <h2 className="h">{title}</h2>
        <span className="mt">iniciada {brDateTime(job.startedAt)}</span>
        <span className="sp" />
        {job.status === 'running' && !job.stopRequested && (
          <button className="bt dn sm" onClick={onStop}>
            Interromper com segurança
          </button>
        )}
        {job.status !== 'running' && (
          <button className="bt sm" onClick={onClose}>
            Fechar
          </button>
        )}
      </div>
      {job.status === 'running' && (
        <div className="li mt">
          {job.waitingUntil ? `Aguardando o intervalo entre mensagens: próxima em ${wait} s.` : job.phase ? `${job.phase}…` : 'Trabalhando…'}
        </div>
      )}
      {job.lines.map((line, index) => (
        <div className="li" key={index}>
          <Chip color={line.tone ?? 'gy'} dot={false}>
            {TONE_LABEL[line.tone ?? 'gy']}
          </Chip>
          <span style={{ flex: 1 }}>{line.text}</span>
        </div>
      ))}
      {job.error && (
        <div className="cdb">
          <ErrorBox error={job.error} />
        </div>
      )}
      {job.status !== 'running' && job.summary.length > 0 && (
        <div className="li" style={{ background: 'var(--s2)', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
          {job.summary.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>
      )}
    </section>
  );
};
