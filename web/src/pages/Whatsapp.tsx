import { useState } from 'react';
import { type WaDryRun, type WaMessageRow, type WhatsappData, useApi, whatsappApi } from '../api';
import { JobPanel, useJob } from '../components/JobPanel';
import { Banner, Chip, Dialog, ErrorBox, Loading, StatusChip, statusLabel, useAction } from '../components/ui';
import { brDateTime } from '../format';
import { Link } from '../router';

const DAYS = ['', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
const STATUSES = ['draft', 'approved', 'sending', 'sent', 'failed', 'unknown', 'cancelled'] as const;

const windowLabel = (config: WhatsappData['config']) => {
  const days = config.window.days;
  const range = days.length > 1 && days.every((day, index) => index === 0 || day === days[index - 1]! + 1) ? `${DAYS[days[0]!]} a ${DAYS[days.at(-1)!]}` : days.map((day) => DAYS[day]).join(', ');
  return `${range}, ${config.window.startHour}h às ${config.window.endHour}h`;
};

const Stat = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <div className="cd" style={{ flex: '1 1 190px' }}>
    <div className="cdb" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span className="mono" style={{ fontSize: 22 }}>
        {value}
      </span>
      <span className="mt">{label}</span>
      {sub && <span className="mt">{sub}</span>}
    </div>
  </div>
);

const MessageDialog = ({ message, onClose, onChanged }: { message: WaMessageRow; onClose: () => void; onChanged: () => Promise<void> }) => {
  const { run, busy } = useAction();
  const editable = message.status === 'draft' || message.status === 'approved';
  const [body, setBody] = useState(message.body);
  const [cancelling, setCancelling] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [reason, setReason] = useState('');
  const done = async <T,>(work: () => Promise<T>, success: string) => {
    const result = await run(work, { success, reload: [onChanged] });
    if (result !== undefined) onClose();
  };

  return (
    <Dialog label="Mensagem de WhatsApp" onClose={onClose} width={640}>
      <h2 className="h" style={{ fontSize: 17 }}>
        {message.lead?.name ?? 'Lead removido'}
      </h2>
      <div className="row">
        <StatusChip status={message.status} />
        <span className="mono">{message.toPhone}</span>
        {message.lead && (
          <Link className="mt" to="/leads" style={{ textDecoration: 'underline' }}>
            ver na tela de leads
          </Link>
        )}
      </div>
      {message.error && <ErrorBox error={message.error} />}
      {message.cancelReason && <div className="bn gy"><span>Cancelada: {message.cancelReason}</span></div>}
      {message.status === 'unknown' && (
        <Banner color="am" icon="warn">
          Não houve confirmação do envio. Confira no WhatsApp se a mensagem saiu e diga abaixo. Ela nunca é reenviada sozinha.
        </Banner>
      )}
      <label className="lb">
        Texto
        <textarea className="in" rows={6} value={body} disabled={!editable} onChange={(event) => setBody(event.target.value)} />
      </label>
      {editable && body !== message.body && <div className="mt">Salvar volta a mensagem para rascunho: ela precisa ser aprovada de novo.</div>}
      <div className="mt">
        {message.sentAt ? `Enviada em ${brDateTime(message.sentAt, true)}. ` : ''}
        {message.approvedAt ? `Aprovada em ${brDateTime(message.approvedAt, true)}. ` : ''}Criada em {brDateTime(message.createdAt, true)}.
      </div>

      {cancelling && (
        <label className="lb">
          Motivo do cancelamento
          <input className="in" value={reason} onChange={(event) => setReason(event.target.value)} autoFocus />
        </label>
      )}
      {blocking && (
        <>
          <label className="lb">
            Motivo (o que a pessoa disse)
            <input className="in" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ex.: respondeu que não tem interesse" autoFocus />
          </label>
          <Banner color="dr" icon="warn">
            Permanente: o número nunca mais é contatado e o que estiver na fila para ele é cancelado. Não há como desfazer.
          </Banner>
        </>
      )}

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="bt" onClick={onClose}>
          Fechar
        </button>
        {message.status !== 'sent' && message.status !== 'cancelled' && !blocking && (
          <button className="bt dn" onClick={() => (setBlocking(true), setCancelling(false), setReason(''))}>
            Recusou: não contatar mais
          </button>
        )}
        {blocking && (
          <button className="bt dn" disabled={busy || reason.trim().length < 3} onClick={() => done(() => whatsappApi.suppress(message.toPhone, reason), 'Número bloqueado para sempre')}>
            Bloquear para sempre
          </button>
        )}
        {['draft', 'approved', 'failed'].includes(message.status) && !cancelling && !blocking && (
          <button className="bt" onClick={() => (setCancelling(true), setReason(''))}>
            Cancelar mensagem
          </button>
        )}
        {cancelling && (
          <button className="bt dn" disabled={busy || !reason.trim()} onClick={() => done(() => whatsappApi.cancel(message.id, reason), 'Mensagem cancelada')}>
            Confirmar cancelamento
          </button>
        )}
        {message.status === 'failed' && (
          <button className="bt" disabled={busy} onClick={() => done(() => whatsappApi.retry(message.id), 'De volta à fila')}>
            Tentar de novo
          </button>
        )}
        {message.status === 'unknown' && (
          <>
            <button className="bt" disabled={busy} onClick={() => done(() => whatsappApi.resolve(message.id, false), 'Voltou para a fila')}>
              Não saiu
            </button>
            <button className="bt p" disabled={busy} onClick={() => done(() => whatsappApi.resolve(message.id, true), 'Marcada como enviada')}>
              Saiu
            </button>
          </>
        )}
        {editable && (
          <button className="bt" disabled={busy || !body.trim() || body === message.body} onClick={() => done(() => whatsappApi.edit(message.id, body), 'Salva como rascunho')}>
            Salvar texto
          </button>
        )}
        {message.status === 'draft' && (
          <button className="bt p" disabled={busy || body !== message.body} onClick={() => done(() => whatsappApi.approve({ ids: [message.id] }), 'Aprovada')}>
            Aprovar
          </button>
        )}
      </div>
    </Dialog>
  );
};

const ConfirmRun = ({ onClose, onConfirm }: { onClose: () => void; onConfirm: (typed: string) => void }) => {
  const [typed, setTyped] = useState('');
  return (
    <Dialog label="Confirmar envio real" onClose={onClose}>
      <h2 className="h" style={{ fontSize: 17 }}>
        Envio real no WhatsApp
      </h2>
      <Banner color="rd" icon="warn">
        As mensagens aprovadas serão entregues de verdade e não dá para desfazer. Digite <span className="mono">ENVIAR</span> para confirmar.
      </Banner>
      <input className="in mono" value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" autoFocus />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="bt" onClick={onClose}>
          Cancelar
        </button>
        <button className="bt p" disabled={typed !== 'ENVIAR'} onClick={() => onConfirm(typed)}>
          Enviar de verdade
        </button>
      </div>
    </Dialog>
  );
};

export const WhatsappPage = () => {
  const { data, error, reload } = useApi<WhatsappData>('/api/whatsapp');
  const { run, busy } = useAction();
  const { job, start, stop, running } = useJob(['wa.run'], () => void reload());
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [dry, setDry] = useState<WaDryRun | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [skipped, setSkipped] = useState<{ name: string; reason: string }[] | null>(null);

  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const { config, today, counts, channel } = data;
  const rows = data.messages.filter((message) => !filter || message.status === filter);
  const message = data.messages.find((item) => item.id === open);

  const begin = () => (channel.delivers ? setConfirming(true) : (setDismissed(null), void start('wa.run')));

  return (
    <>
      <div className="row">
        <div>
          <h1 className="t">Fila de WhatsApp</h1>
          <div className="sub">A primeira mensagem de cada lead: texto fixo, com limite diário, intervalos aleatórios e só em horário comercial.</div>
        </div>
        <span className="sp" />
        <button className="bt p" disabled={running} onClick={begin}>
          Executar rotina completa
        </button>
      </div>

      {channel.delivers ? (
        <Banner color="rd" icon="warn">
          <b>Envio real:</b> o canal <b>{channel.name}</b> entrega as mensagens aos leads. A rotina exige digitar <span className="mono">ENVIAR</span>.
        </Banner>
      ) : (
        <Banner color="bl">
          <b>Modo simulação:</b> nada sai da máquina. As mensagens ficam gravadas como arquivos na pasta de saída local.
        </Banner>
      )}

      <div className="row" style={{ alignItems: 'stretch' }}>
        <Stat label="iniciadas hoje" value={`${today.startedToday} de ${config.dailyLimit}`} sub={`restam ${today.remaining}`} />
        <Stat label="horário de envio" value={today.inWindow ? 'aberto' : 'fechado'} sub={windowLabel(config)} />
        <Stat label="intervalo entre mensagens" value={`${config.minIntervalSeconds / 60}–${config.maxIntervalSeconds / 60} min`} sub="aleatório" />
        <Stat label="aprovação" value={config.autoApprove ? 'automática' : 'manual'} sub={config.autoApprove ? 'o texto abaixo é a revisão' : 'aprove cada rascunho'} />
      </div>

      <section className="cd">
        <div className="cdh">
          <h2 className="h">Texto da primeira mensagem</h2>
          <span className="mt">Edite em config/whatsapp.json. Vale para todas: {'{{lead.shortName}}'} vira o nome curto da imobiliária e {'{{sender.nickname}}'} o seu apelido (SENDER_NICKNAME).</span>
        </div>
        <div className="cdb" style={{ whiteSpace: 'pre-wrap' }}>
          {config.firstMessage}
        </div>
      </section>

      <section className="cd">
        <div className="cdh">
          <h2 className="h">Ações</h2>
          <span className="mt">
            {data.ready} lead(s) de bom perfil esperam mensagem · {counts.draft} rascunho(s) · {counts.approved} aprovada(s)
          </span>
        </div>
        <div className="cdb row">
          <button
            className="bt"
            disabled={busy || running || data.ready === 0}
            title="Cria a mensagem para os leads que a IA aprovou"
            onClick={async () => {
              const result = await run(() => whatsappApi.draft(), { reload: [reload] });
              if (result) setSkipped(result.skipped.length ? result.skipped : null);
            }}
          >
            Preparar mensagens ({data.ready})
          </button>
          {!config.autoApprove && (
            <button className="bt" disabled={busy || running || counts.draft === 0} onClick={() => run(() => whatsappApi.approve({ all: true }), { success: 'Rascunhos aprovados', reload: [reload] })}>
              Aprovar todos os rascunhos ({counts.draft})
            </button>
          )}
          <button className="bt" disabled={busy || running} title="Mostra o que sairia agora, sem enviar" onClick={async () => setDry((await run(() => whatsappApi.dryRun())) ?? null)}>
            Simular o envio
          </button>
        </div>
      </section>

      {skipped && (
        <Banner color="gy">
          <b>{skipped.length} lead(s) ficaram sem mensagem.</b> Principais motivos:{' '}
          {[...new Set(skipped.map((item) => item.reason.split('.')[0]))].slice(0, 3).join(' · ')}. Veja cada um na tela <Link to="/leads" style={{ textDecoration: 'underline' }}>Leads</Link>.
        </Banner>
      )}

      {dry && (
        <section className="cd">
          <div className="cdh">
            <h2 className="h">Simulação: o que sairia agora</h2>
            <span className="mt">Nada foi enviado</span>
            <span className="sp" />
            <button className="bt sm" onClick={() => setDry(null)}>
              Fechar
            </button>
          </div>
          {dry.stopped && <div className="li mt">{dry.stopped}</div>}
          {dry.outcomes.length === 0 && <div className="li mt">Nenhuma mensagem aprovada na fila.</div>}
          {dry.outcomes.map((item) => (
            <div className="li" key={item.id}>
              <span className="nm" style={{ flex: '0 0 240px' }}>{item.name}</span>
              <span className="mono mt" style={{ flex: '1 1 160px' }}>{item.phone}</span>
              <Chip color={item.outcome === 'would_send' ? 'gn' : 'gy'}>{item.outcome === 'would_send' ? 'enviaria' : 'pulada'}</Chip>
              {item.detail && <span className="mt" style={{ flex: '1 1 100%' }}>{item.detail}</span>}
            </div>
          ))}
          <div className="li mt">Restam hoje: {dry.remainingToday}.</div>
        </section>
      )}

      {job && dismissed !== job.id && <JobPanel job={job} onStop={stop} onClose={() => setDismissed(job.id)} />}

      <div className="row">
        <button className={`bt sm${filter === '' ? ' p' : ''}`} onClick={() => setFilter('')}>
          Todas ({data.messages.length})
        </button>
        {STATUSES.filter((status) => counts[status] > 0).map((status) => (
          <button key={status} className={`bt sm${filter === status ? ' p' : ''}`} onClick={() => setFilter(status)}>
            {statusLabel(status)} ({counts[status]})
          </button>
        ))}
      </div>

      <div className="tbw">
        <table className="tb">
          <thead>
            <tr>
              {['Lead', 'Número', 'Mensagem', 'Situação'].map((label) => (
                <th key={label} scope="col">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="mt">
                  {data.messages.length === 0 ? 'Nenhuma mensagem ainda. Rode a rotina ou prepare as mensagens dos leads aprovados.' : 'Nenhuma mensagem com esse status.'}
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} onClick={() => setOpen(row.id)} style={{ cursor: 'pointer' }}>
                <td>
                  <div className="nm">{row.lead?.name ?? 'Lead removido'}</div>
                  <div className="mt">{[row.lead?.city, row.lead?.state].filter(Boolean).join(' - ')}</div>
                </td>
                <td className="mono">{row.toPhone}</td>
                <td style={{ maxWidth: 420 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.body}</div>
                  {row.error && <div className="mt" style={{ color: 'var(--rf, inherit)' }}>{row.error}</div>}
                </td>
                <td>
                  <StatusChip status={row.status} />
                  <div className="mt">{brDateTime(row.sentAt ?? row.approvedAt ?? row.createdAt)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {message && <MessageDialog key={message.id + message.status + message.updatedAt} message={message} onClose={() => setOpen(null)} onChanged={reload} />}
      {confirming && (
        <ConfirmRun
          onClose={() => setConfirming(false)}
          onConfirm={(typed) => {
            setConfirming(false);
            setDismissed(null);
            void start('wa.run', typed);
          }}
        />
      )}
    </>
  );
};
