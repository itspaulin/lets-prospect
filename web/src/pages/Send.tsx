import { useEffect, useState } from 'react';
import { campaignApi, type CampaignListItem, type DryRun, type JobOutcome, type SendJob, api, useApi } from '../api';
import { Banner, Chip, ErrorBox, Loading, statusLabel, useMeta, useToast } from '../components/ui';
import { untilUtcMidnight } from '../format';
import { Link, navigate, useLocation } from '../router';

const OUTCOME: Record<JobOutcome['outcome'], { color: string; label: string }> = {
  would_send: { color: 'gn', label: 'enviaria' },
  sent: { color: 'gn', label: 'sent' },
  failed: { color: 'rd', label: 'failed' },
  unknown: { color: 'am', label: 'unknown' },
  skipped: { color: 'gy', label: 'pulada' },
  cancelled: { color: 'rd', label: 'cancelada' },
};

const Row = ({ item }: { item: JobOutcome }) => (
  <div className="li">
    <Link className="nm" to={`/empresas/${item.company.domain}`} style={{ flex: '0 0 200px' }}>
      {item.company.name}
    </Link>
    <span className="mono mt" style={{ flex: '1 1 220px' }}>
      {item.toEmail} · etapa {item.step}
    </span>
    <Chip color={OUTCOME[item.outcome].color}>{OUTCOME[item.outcome].label}</Chip>
    {item.detail && <span className="mt" style={{ flex: '1 1 100%' }}>{item.detail}</span>}
  </div>
);

const Running = ({ initial, onFinished }: { initial: SendJob; onFinished: () => void }) => {
  const [job, setJob] = useState(initial);
  const [now, setNow] = useState(Date.now());
  const meta = useMeta();
  useEffect(() => {
    if (job.status !== 'running') return;
    const id = window.setInterval(async () => {
      setNow(Date.now());
      try {
        const next = await api.get<SendJob | null>('/api/send-job');
        if (next) setJob(next);
      } catch {
        /* keep polling */
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [job.status]);
  useEffect(() => {
    if (job.status !== 'running') {
      void meta.reload();
      onFinished();
    }
  }, [job.status]);

  const remaining = job.waitingUntil ? Math.max(0, Math.ceil((Date.parse(job.waitingUntil) - now) / 1000)) : 0;
  const sent = job.outcomes.filter((item) => item.outcome === 'sent').length;
  const problems = job.outcomes.filter((item) => item.outcome === 'failed' || item.outcome === 'unknown').length;
  const title =
    job.status === 'running' ? (job.stopRequested ? 'Interrompendo após a mensagem atual…' : 'Enviando') : job.status === 'stopped' ? 'Envio interrompido' : job.status === 'failed' ? 'Envio falhou' : 'Envio concluído';

  return (
    <section className="cd">
      <div className="cdh">
        <h2 className="h">{title}</h2>
        <span className="mt">
          {job.outcomes.length} de {job.total} processadas · {sent} enviada(s)
        </span>
        <span className="sp" />
        {job.status === 'running' && !job.stopRequested && (
          <button className="bt dn" onClick={async () => setJob((await api.post<SendJob>('/api/send-job/stop')) ?? job)}>
            Interromper com segurança
          </button>
        )}
      </div>
      <div className="cdb">
        <div className="prog" style={{ maxWidth: 'none' }}>
          {Array.from({ length: job.total }, (_, position) => {
            const outcome = job.outcomes[position]?.outcome;
            return <i key={position} className={outcome === 'sent' ? 'd' : outcome === 'failed' || outcome === 'unknown' ? 'x' : outcome ? 's' : position === job.outcomes.length ? 'c' : ''} />;
          })}
        </div>
      </div>
      {job.outcomes.map((item) => (
        <Row key={item.messageId} item={item} />
      ))}
      {job.status === 'running' && (
        <div className="li mt">{job.waitingUntil ? `Aguardando o intervalo mínimo: próxima em ${remaining} s.` : 'Entregando ao provedor…'}</div>
      )}
      {job.error && (
        <div className="cdb">
          <ErrorBox error={job.error} />
        </div>
      )}
      {job.status !== 'running' && (
        <div className="li" style={{ background: 'var(--s2)', borderRadius: '0 0 8px 8px' }}>
          <span style={{ flex: 1 }}>
            {problems
              ? `${problems} mensagem(ns) com falha ou sem confirmação. Nada disso é reenviado sozinho.`
              : job.status === 'stopped'
                ? 'As mensagens que faltaram continuam aprovadas para o próximo envio.'
                : 'Tudo processado. Rodar de novo nunca duplica.'}
          </span>
          {problems > 0 && (
            <Link className="bt" to="/conciliacao">
              Conciliação e falhas
            </Link>
          )}
          <Link className="bt" to="/">
            Voltar para Hoje
          </Link>
        </div>
      )}
    </section>
  );
};

export const SendPage = () => {
  const { query } = useLocation();
  const meta = useMeta().data!;
  const toast = useToast();
  const campaign = query.get('campanha') ?? '';
  const campaigns = useApi<CampaignListItem[]>('/api/campaigns');
  const current = useApi<SendJob | null>('/api/send-job');
  const [dry, setDry] = useState<{ data?: DryRun; error?: string; loading: boolean }>({ loading: false });
  const [phase, setPhase] = useState<'dry' | 'confirm' | 'run'>('dry');
  const [typed, setTyped] = useState('');
  const [job, setJob] = useState<SendJob | null>(null);
  const [starting, setStarting] = useState(false);

  const simulate = async () => {
    if (!campaign) return;
    setDry({ loading: true });
    try {
      setDry({ data: await campaignApi.dryRun(campaign), loading: false });
    } catch (error) {
      setDry({ error: (error as Error).message, loading: false });
    }
  };
  useEffect(() => {
    setPhase('dry');
    setTyped('');
    void simulate();
  }, [campaign]);
  useEffect(() => {
    if (current.data?.status === 'running' && !job) {
      setJob(current.data);
      setPhase('run');
    }
  }, [current.data]);

  const sendable = dry.data?.outcomes.filter((item) => item.outcome === 'would_send') ?? [];
  const blocked = dry.data?.outcomes.filter((item) => item.outcome !== 'would_send') ?? [];
  const minutes = Math.max(0, Math.ceil(((sendable.length - 1) * (dry.data?.minIntervalSeconds ?? 0)) / 60));
  const real = meta.delivers;

  const start = async () => {
    setStarting(true);
    try {
      const started = await campaignApi.send(campaign, real ? typed : undefined);
      setJob(started);
      setPhase('run');
    } catch (error) {
      toast((error as Error).message, 'rd');
    } finally {
      setStarting(false);
    }
  };

  const withApproved = (campaigns.data ?? []).filter((item) => item.status !== 'closed');

  return (
    <>
      <div className="row">
        <div>
          {campaign && (
            <Link className="mt" to={`/campanhas/${encodeURIComponent(campaign)}?etapa=7`}>
              ← <span className="mono">{campaign}</span>
            </Link>
          )}
          <h1 className="t">Envio</h1>
        </div>
        <span className="sp" />
        <label className="lb" data-tour="send-campaign">
          Campanha
          <select className="in" value={campaign} onChange={(event) => navigate(`/envio?campanha=${encodeURIComponent(event.target.value)}`, { replace: true })} disabled={phase === 'run'}>
            <option value="">Escolha…</option>
            {withApproved.map((item) => (
              <option key={item.id} value={item.name}>
                {item.name} · {item.metrics.approved} aprovada(s) · {statusLabel(item.status).toLowerCase()}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div data-tour="send-mode">
      {real ? (
        <Banner color="rd" icon="warn">
          <b>SMTP real:</b> os e-mails serão entregues aos destinatários. Não dá para desfazer. A confirmação exige digitar <span className="mono">ENVIAR</span>.
        </Banner>
      ) : (
        <Banner color="bl">
          <b>Modo simulação (outbox):</b> nada sai da máquina. Os e-mails são gravados na caixa de saída local; ninguém recebe nada.
        </Banner>
      )}
      </div>

      <div className="stp" data-tour="send-steps">
        {['Simulação', 'Confirmação', 'Envio'].map((label, index) => {
          const order = ['dry', 'confirm', 'run'].indexOf(phase);
          return (
            <span key={label} className={index === order ? 'on' : index < order ? 'done' : ''}>
              <b className="mono">{index + 1}</b> {label}
            </span>
          );
        })}
      </div>

      {!campaign && phase !== 'run' && <div className="mt">Escolha a campanha para simular o envio.</div>}

      {campaign && phase === 'dry' && (
        <>
          {dry.loading && <Loading />}
          {dry.error && <ErrorBox error={dry.error} onRetry={simulate} />}
          {dry.data && (
            <div className="grid2">
              <section className="cd" style={{ flex: '2 1 520px' }}>
                <div className="cdh">
                  <h2 className="h">Simulação: o que seria enviado</h2>
                  <span className="mt">Nada foi enviado ainda</span>
                  <span className="sp" />
                  <button className="bt sm" onClick={simulate}>
                    Simular de novo
                  </button>
                </div>
                {sendable.length === 0 && <div className="li mt">Nenhuma mensagem seria enviada agora.</div>}
                {sendable.map((item) => (
                  <Row key={item.messageId} item={item} />
                ))}
                {blocked.length > 0 && (
                  <>
                    <div className="cdh" style={{ borderTop: '1px solid var(--ln)' }}>
                      <h2 className="h">Bloqueadas ({blocked.length})</h2>
                      <span className="mt">Motivos permanentes cancelam a mensagem no envio real; temporários (campanha pausada, limite) só adiam.</span>
                    </div>
                    {blocked.map((item) => (
                      <Row key={item.messageId} item={item} />
                    ))}
                  </>
                )}
              </section>
              <aside className="cd" style={{ flex: '1 1 300px' }}>
                <div className="cdh">
                  <h2 className="h">Resumo</h2>
                </div>
                <div className="cdb" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <span className="mono" style={{ fontSize: 22 }}>
                      {sendable.length}
                    </span>{' '}
                    <span className="mt">mensage{sendable.length === 1 ? 'm' : 'ns'} agora</span>
                  </div>
                  <div>
                    <div className="row" style={{ gap: 6 }}>
                      <span className="mt">Limite restante hoje</span>
                      <span className="sp" />
                      <b>
                        {meta.sending.dailyLimit - meta.sentToday} de {meta.sending.dailyLimit}
                      </b>
                    </div>
                    <div className="mt">
                      Já enviadas hoje: {meta.sentToday}. O limite zera às 21:00 em Brasília (00:00 UTC), em {untilUtcMidnight()}.
                    </div>
                  </div>
                  <div>
                    <b>≈ {minutes} min</b> <span className="mt">de duração: intervalos de {dry.data.minIntervalSeconds} s entre mensagens</span>
                  </div>
                  <div className="bn gy">
                    <span>
                      <b>Rodar de novo nunca duplica.</b> Cada mensagem tem Message-ID e trava de envio; sent, sending e unknown não são reenviadas.
                    </span>
                  </div>
                  <button className="bt p" disabled={sendable.length === 0} onClick={() => setPhase('confirm')}>
                    Continuar para confirmação
                  </button>
                </div>
              </aside>
            </div>
          )}
        </>
      )}

      {phase === 'confirm' && dry.data && (
        <section className="cd">
          <div className="cdh">
            <h2 className="h">Confirmação</h2>
          </div>
          <div className="cdb" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              Você vai {real ? 'enviar' : 'gravar na caixa de saída'} <b>{sendable.length} e-mail(s)</b> a partir de{' '}
              <span className="mono">{dry.data.from.email || '(SENDER_EMAIL vazio)'}</span>, com {dry.data.minIntervalSeconds} s entre cada um.
            </div>
            {real ? (
              <label className="lb" style={{ maxWidth: 360 }}>
                Digite ENVIAR para confirmar o envio real
                <input className="in mono" value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" autoFocus />
              </label>
            ) : (
              <div className="mt">Modo simulação: não é preciso digitar nada.</div>
            )}
            <div className="row">
              <button className="bt" onClick={() => setPhase('dry')}>
                Voltar
              </button>
              <button className="bt p" disabled={starting || (real && typed !== 'ENVIAR')} onClick={start}>
                {real ? 'Enviar de verdade' : 'Gravar na caixa de saída'}
              </button>
            </div>
          </div>
        </section>
      )}

      {phase === 'run' && job && <Running initial={job} onFinished={() => void campaigns.reload()} />}
    </>
  );
};
