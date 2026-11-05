import { useState } from 'react';
import { type Conciliation, messageApi, useApi } from '../api';
import { Banner, Dialog, ErrorBox, Loading, StatusChip, useAction } from '../components/ui';
import { brDateTime, brTime, utcLabel } from '../format';
import { Link } from '../router';

type Item = Conciliation['unknown'][number];

const Attempts = ({ item }: { item: Item }) => (
  <table className="tb" style={{ marginTop: 6 }}>
    <thead>
      <tr>
        <th scope="col">Início</th>
        <th scope="col">Fim</th>
        <th scope="col">Resultado</th>
        <th scope="col">Erro</th>
      </tr>
    </thead>
    <tbody>
      {item.attempts.map((attempt) => (
        <tr key={attempt.id}>
          <td title={utcLabel(attempt.startedAt)}>{brDateTime(attempt.startedAt)}</td>
          <td>{attempt.finishedAt ? <span title={utcLabel(attempt.finishedAt)}>{brTime(attempt.finishedAt)}</span> : '—'}</td>
          <td>
            <StatusChip status={attempt.outcome} />
          </td>
          <td className="mono">{attempt.error ?? '—'}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

export const ConciliationPage = () => {
  const { data, error, reload } = useApi<Conciliation>('/api/conciliation');
  const { run, busy } = useAction();
  const [resolving, setResolving] = useState<{ item: Item; sent: boolean } | null>(null);
  const [note, setNote] = useState('');
  const [cancelling, setCancelling] = useState<Item | null>(null);

  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;

  return (
    <>
      <div>
        <h1 className="t">Conciliação e falhas</h1>
        <div className="sub">Nada aqui é reenviado sozinho. Você decide cada caso.</div>
      </div>

      <section className="cd" data-tour="conc-unknown">
        <div className="cdh">
          <span className="cnt am">{data.unknown.length}</span>
          <h2 className="h">Envios sem confirmação (unknown)</h2>
          <span className="mt">O provedor pode ou não ter aceitado. Confira a pasta Enviados da caixa antes de decidir.</span>
        </div>
        {data.unknown.length === 0 && <div className="cdb mt">Nenhum envio desconhecido.</div>}
        {data.unknown.map((item) => (
          <div className="li" key={item.id} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <div className="row">
              <Link className="nm" to={`/empresas/${item.company.domain}?tab=mensagens`}>
                {item.company.name}
              </Link>
              <span className="mono mt">{item.toEmail}</span>
              <span className="mt">
                etapa {item.step} · <span className="mono">{item.campaign}</span>
              </span>
              <span className="sp" />
              <button className="bt sm" disabled={busy} onClick={() => (setNote(''), setResolving({ item, sent: true }))}>
                Foi enviada
              </button>
              <button className="bt sm" disabled={busy} onClick={() => (setNote(''), setResolving({ item, sent: false }))}>
                Não foi enviada
              </button>
            </div>
            <div className="mt">Assunto: {item.subject}</div>
            <Attempts item={item} />
          </div>
        ))}
      </section>

      <section className="cd" data-tour="conc-failed">
        <div className="cdh">
          <span className="cnt rd">{data.failed.length}</span>
          <h2 className="h">Envios com falha (failed)</h2>
          <span className="mt">O provedor recusou; nada foi entregue.</span>
        </div>
        {data.failed.length === 0 && <div className="cdb mt">Nenhuma falha.</div>}
        {data.failed.map((item) => (
          <div className="li" key={item.id} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <div className="row">
              <Link className="nm" to={`/empresas/${item.company.domain}?tab=mensagens`}>
                {item.company.name}
              </Link>
              <span className="mono mt">{item.toEmail}</span>
              <span className="mt">
                etapa {item.step} · <span className="mono">{item.campaign}</span>
              </span>
              <span className="sp" />
              <button className="bt sm" disabled={busy} onClick={() => run(() => messageApi.retry(item.id), { success: 'Voltou para approved: sai no próximo envio.', reload: [reload] })}>
                Tentar de novo
              </button>
              <button className="bt sm dn" disabled={busy} onClick={() => (setNote(''), setCancelling(item))}>
                Cancelar
              </button>
            </div>
            <div className="mono mt">{item.error}</div>
            <Attempts item={item} />
          </div>
        ))}
      </section>

      {resolving && (
        <Dialog label="Conciliar envio" onClose={() => setResolving(null)}>
          <h2 className="h" style={{ fontSize: 17 }}>
            {resolving.sent ? 'Registrar como enviada' : 'Registrar como não enviada'}
          </h2>
          <Banner color={resolving.sent ? 'gn' : 'am'} icon="info">
            {resolving.sent
              ? 'A mensagem vira sent, a empresa vai para contacted (se for o 1º contato) e o follow-up é agendado.'
              : 'A mensagem volta para approved e sai no próximo envio. Use só se tiver certeza de que não está na pasta Enviados.'}
          </Banner>
          <label className="lb">
            Nota (o que você conferiu)
            <input className="in" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ex.: consta em Enviados às 11:08" />
          </label>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="bt" onClick={() => setResolving(null)}>
              Voltar
            </button>
            <button
              className="bt p"
              disabled={busy}
              onClick={async () => {
                await run(() => messageApi.resolve(resolving.item.id, resolving.sent, note.trim() || undefined), { success: 'Conciliação registrada no histórico.', reload: [reload] });
                setResolving(null);
              }}
            >
              Confirmar
            </button>
          </div>
        </Dialog>
      )}

      {cancelling && (
        <Dialog label="Cancelar mensagem" onClose={() => setCancelling(null)}>
          <h2 className="h" style={{ fontSize: 17 }}>
            Cancelar a mensagem para {cancelling.company.name}?
          </h2>
          <label className="lb">
            Motivo
            <input className="in" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ex.: endereço recusado pelo servidor" />
          </label>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="bt" onClick={() => setCancelling(null)}>
              Voltar
            </button>
            <button
              className="bt dn"
              disabled={busy || note.trim().length < 3}
              onClick={async () => {
                await run(() => messageApi.cancel(cancelling.id, note), { success: 'Mensagem cancelada.', reload: [reload] });
                setCancelling(null);
              }}
            >
              Cancelar mensagem
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
};
