import { useCallback, useEffect, useState } from 'react';
import { messageApi, type ReviewItem, useApi } from '../api';
import { Banner, Chip, Dialog, ErrorBox, Loading, MailPreview, PersonalizationChip, StatusChip, useAction } from '../components/ui';
import { pct } from '../format';
import { Link, navigate, useLocation } from '../router';

export const ReviewPage = () => {
  const { query } = useLocation();
  const campaign = query.get('campanha') ?? '';
  const { data, error, reload } = useApi<ReviewItem[]>(`/api/review${campaign ? `?campaign=${encodeURIComponent(campaign)}` : ''}`);
  const { run, busy } = useAction();
  const [index, setIndex] = useState(0);
  const [editing, setEditing] = useState<{ subject: string; body: string } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [done, setDone] = useState(0);

  const items = data ?? [];
  const item = items[Math.min(index, Math.max(items.length - 1, 0))];

  const approve = useCallback(async () => {
    if (!item) return;
    const result = await run(() => messageApi.approve(item.id), { success: `${item.company.name}: aprovada e travada por hash.`, reload: [reload] });
    if (result) setDone((value) => value + 1);
  }, [item, run, reload]);
  const skip = useCallback(() => setIndex((value) => (items.length ? (value + 1) % items.length : 0)), [items.length]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (editing || cancelling || busy || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      const key = event.key.toLowerCase();
      if (key === 'a') (event.preventDefault(), void approve());
      if (key === 's') (event.preventDefault(), skip());
      if (key === 'e' && item) (event.preventDefault(), setEditing({ subject: item.subject, body: item.body }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [approve, skip, item, editing, cancelling, busy]);

  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;

  const header = (
    <div className="row">
      <div>
        <h1 className="t">Fila de revisão</h1>
        <div className="sub">
          {campaign ? (
            <>
              Campanha <span className="mono">{campaign}</span> ·{' '}
              <button className="lnk" onClick={() => navigate('/revisao', { replace: true })}>
                ver todas
              </button>
            </>
          ) : (
            'Todas as campanhas'
          )}{' '}
          · {items.length} na fila{done ? ` · ${done} aprovada(s) nesta sessão` : ''}
        </div>
      </div>
      <span className="sp" />
      <span className="mt">
        <kbd>A</kbd> aprovar · <kbd>E</kbd> editar · <kbd>S</kbd> pular
      </span>
    </div>
  );

  if (!item)
    return (
      <>
        {header}
        <section className="cd">
          <div className="cdb" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <b>Fila vazia.</b>
            <span className="mt">Nenhum rascunho aguardando revisão{campaign ? ' nesta campanha' : ''}.</span>
            <div className="row">
              <Link className="bt p" to={campaign ? `/envio?campanha=${encodeURIComponent(campaign)}` : '/campanhas'}>
                {campaign ? 'Ir para o envio' : 'Ver campanhas'}
              </Link>
            </div>
          </div>
        </section>
      </>
    );

  const position = items.indexOf(item);
  const score = item.company.qualification;

  return (
    <>
      {header}
      <div className="prog" aria-label={`Mensagem ${position + 1} de ${items.length}`}>
        {items.map((entry, position2) => (
          <i key={entry.id} className={position2 === position ? 'c' : ''} />
        ))}
      </div>
      <div className="grid2">
        <section className="cd" style={{ flex: '2 1 520px' }}>
          <div className="cdh">
            <b>
              {position + 1} de {items.length}
            </b>
            <span className="mono mt">{item.campaign}</span>
            <span className="mt">etapa {item.step}</span>
            <span className="sp" />
            <PersonalizationChip value={item.personalization} />
          </div>
          <div className="cdb" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {item.personalization === 'generic' && (
              <Banner color="am" icon="warn">
                Mensagem genérica: não cita nenhum fato da empresa. Mande só se fizer sentido assim{item.verifiedEvidenceCount ? '; há fatos verificados que poderiam personalizá-la' : ''}.
              </Banner>
            )}
            <div data-tour="review-mail">
              <MailPreview from={item.from} to={item.toEmail} subject={item.subject} body={item.body} />
            </div>
            <div className="row" data-tour="review-actions">
              <button className="bt p" disabled={busy} onClick={approve}>
                Aprovar <kbd style={{ background: 'transparent', color: 'inherit', borderColor: 'currentColor' }}>A</kbd>
              </button>
              <button className="bt" disabled={busy} onClick={() => setEditing({ subject: item.subject, body: item.body })}>
                Editar <kbd>E</kbd>
              </button>
              <button className="bt" disabled={busy || items.length < 2} onClick={skip}>
                Pular <kbd>S</kbd>
              </button>
              <Link className="bt" to={`/campanhas/${encodeURIComponent(item.campaign)}/personalizar/${item.company.domain}`}>
                {item.personalization === 'generic' ? 'Personalizar' : 'Trocar motivo'}
              </Link>
              <span className="sp" />
              <button className="bt dn" disabled={busy} onClick={() => (setReason(''), setCancelling(true))}>
                Cancelar mensagem…
              </button>
            </div>
          </div>
        </section>
        <aside className="cd" style={{ flex: '1 1 300px' }} data-tour="review-context">
          <div className="cdh">
            <h2 className="h">Contexto</h2>
          </div>
          <div className="cdb" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <Link className="nm" to={`/empresas/${item.company.domain}`}>
                {item.company.name}
              </Link>{' '}
              <StatusChip status={item.company.status} />
              <div className="mono mt">
                {item.company.domain} · {item.company.country}
              </div>
            </div>
            <div className="mt">
              Pontuação: {score ? `${pct(score.score / score.maxScore)} · cobertura ${pct(score.coverage)}` : 'não avaliada'}
            </div>
            <div>
              {item.contact?.name}
              {item.contact?.role && (
                <Chip color={item.contact.decisionMaker ? 'bl' : 'gy'} dot={false}>
                  {item.contact.role}
                  {item.contact.decisionMaker ? ' · decisor' : ''}
                </Chip>
              )}
            </div>
            <div>
              <div className="mt" style={{ marginBottom: 4 }}>
                Evidências usadas
              </div>
              {item.evidences.length === 0 ? (
                <span className="mt">nenhuma</span>
              ) : (
                item.evidences.map((evidence) => (
                  <div key={evidence.id} className="bn gn" style={{ marginBottom: 4 }}>
                    <div>
                      {evidence.claim}
                      <div className="mt">{evidence.source}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="mt">Aprovar trava o conteúdo por hash. Qualquer edição depois devolve a mensagem para rascunho.</div>
          </div>
        </aside>
      </div>

      {editing && (
        <Dialog label="Editar mensagem" onClose={() => setEditing(null)} width={720}>
          <h2 className="h" style={{ fontSize: 17 }}>
            Editar mensagem para {item.company.name}
          </h2>
          <label className="lb">
            Assunto
            <input className="in" value={editing.subject} onChange={(event) => setEditing({ ...editing, subject: event.target.value })} />
          </label>
          <label className="lb">
            Corpo (inclui o rodapé; mantenha endereço postal e descadastro)
            <textarea className="in mono" rows={14} value={editing.body} onChange={(event) => setEditing({ ...editing, body: event.target.value })} />
          </label>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="bt" onClick={() => setEditing(null)}>
              Cancelar
            </button>
            <button
              className="bt p"
              disabled={busy || !editing.subject.trim() || !editing.body.trim()}
              onClick={async () => {
                await run(() => messageApi.edit(item.id, editing.subject, editing.body), { success: 'Edição salva. Revise e aprove.', reload: [reload] });
                setEditing(null);
              }}
            >
              Salvar edição
            </button>
          </div>
        </Dialog>
      )}

      {cancelling && (
        <Dialog label="Cancelar mensagem" onClose={() => setCancelling(false)}>
          <h2 className="h" style={{ fontSize: 17 }}>
            Cancelar a mensagem para {item.company.name}?
          </h2>
          <div className="mt">Ela não será enviada. O motivo fica no histórico da empresa.</div>
          <label className="lb">
            Motivo
            <input className="in" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ex.: genérica demais para esta empresa" />
          </label>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="bt" onClick={() => setCancelling(false)}>
              Voltar
            </button>
            <button
              className="bt dn"
              disabled={busy || reason.trim().length < 3}
              onClick={async () => {
                await run(() => messageApi.cancel(item.id, reason), { success: 'Mensagem cancelada.', reload: [reload] });
                setCancelling(false);
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
