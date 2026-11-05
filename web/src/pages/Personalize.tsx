import { useEffect, useState } from 'react';
import { campaignApi, type PersonalizeData, type Preview, useApi } from '../api';
import { Banner, ErrorBox, Loading, MailPreview, PersonalizationChip, StatusChip, useAction } from '../components/ui';
import { shortDate } from '../format';
import { Link, navigate } from '../router';

export const PersonalizePage = ({ name, domain }: { name: string; domain: string }) => {
  const { data, error, reload } = useApi<PersonalizeData>(`/api/campaigns/${encodeURIComponent(name)}/personalize/${encodeURIComponent(domain)}`);
  const { run, busy } = useAction();
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<{ data?: Preview; error?: string }>({});

  useEffect(() => {
    if (!data?.message) return;
    setSelected(data.message.evidenceIds);
  }, [data?.message?.id]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      campaignApi
        .preview(name, { step: 0, companyRef: domain, reason: reason.trim() || undefined })
        .then((result) => setPreview({ data: result }))
        .catch((failure: Error) => setPreview({ error: failure.message }));
    }, 300);
    return () => window.clearTimeout(id);
  }, [name, domain, reason]);

  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const locked = data.message && !['draft', 'approved'].includes(data.message.status);
  const verified = data.evidences.filter((evidence) => evidence.certainty === 'verified' && evidence.stance === 'supports');
  const toggle = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  const canSave = !busy && !locked && data.inCampaign && (reason.trim() ? selected.length > 0 : true);

  const save = async (withReason: boolean) => {
    const saved = await run(
      () =>
        campaignApi.draft(name, {
          company: domain,
          reason: withReason ? reason.trim() : undefined,
          evidenceIds: withReason ? selected : undefined,
        }),
      { success: withReason ? 'Rascunho personalizado salvo. Ele volta para a fila de revisão.' : 'Rascunho genérico salvo.' },
    );
    if (saved) navigate(`/campanhas/${encodeURIComponent(name)}?etapa=5`);
  };

  return (
    <>
      <div>
        <Link className="mt" to={`/campanhas/${encodeURIComponent(name)}?etapa=5`}>
          ← <span className="mono">{name}</span>
        </Link>
        <h1 className="t">Personalizar mensagem · {data.company.name}</h1>
        <div className="sub">
          {data.contact ? `${data.contact.name}${data.contact.role ? ` · ${data.contact.role}` : ''} · ` : ''}
          <span className="mono">{data.contact?.email ?? data.company.domain}</span>
          {data.message && (
            <>
              {' '}
              · rascunho atual <StatusChip status={data.message.status} /> <PersonalizationChip value={data.message.personalization} />
            </>
          )}
        </div>
      </div>
      {!data.inCampaign && <Banner color="rd" icon="alert">Esta empresa não está na campanha. Adicione-a na etapa 4.</Banner>}
      {locked && <Banner color="am" icon="warn">A mensagem está {data.message!.status} e não pode mais ser refeita.</Banner>}
      {data.message?.status === 'approved' && <Banner color="am" icon="warn">Esta mensagem já foi aprovada. Salvar de novo a devolve para rascunho e exige nova aprovação.</Banner>}

      <div className="grid2">
        <section className="cd" style={{ flex: '1 1 380px' }} data-tour="personalize-facts">
          <div className="cdh">
            <h2 className="h">Fatos verificados</h2>
            <span className="mt">O motivo precisa citar ao menos um</span>
          </div>
          {verified.length === 0 && (
            <div className="cdb">
              <Banner color="am" icon="warn">
                Nenhum fato verificado a favor.{' '}
                <Link to={`/empresas/${domain}?tab=evidencias`} style={{ textDecoration: 'underline' }}>
                  Registre uma evidência com fonte
                </Link>{' '}
                ou envie a versão genérica.
              </Banner>
            </div>
          )}
          {data.evidences.map((evidence) => {
            const usable = evidence.certainty === 'verified' && evidence.stance === 'supports';
            const on = selected.includes(evidence.id);
            return (
              <div
                key={evidence.id}
                className={`evr${usable ? '' : ' off'}${on ? ' sel' : ''}`}
                onClick={() => usable && toggle(evidence.id)}
                title={usable ? undefined : 'Hipóteses e fatos contrários não podem ser citados'}
              >
                <input type="checkbox" disabled={!usable} checked={on} readOnly />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={usable ? undefined : { fontStyle: 'italic' }}>{evidence.claim}</div>
                  <div className="mt">
                    <span className="mono">{evidence.kind}</span> · {evidence.source ?? 'sem fonte'} · {shortDate(evidence.observedAt)}
                  </div>
                </div>
                <span className={`ch ${usable ? 'gn' : 'am'}`}>{usable ? 'fato' : evidence.certainty === 'verified' ? 'contra' : 'hipótese'}</span>
              </div>
            );
          })}
        </section>

        <section className="cd" style={{ flex: '1 1 460px' }} data-tour="personalize-reason">
          <div className="cdh">
            <h2 className="h">Motivo e preview</h2>
          </div>
          <div className="cdb" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label className="lb">
              Motivo (uma frase em inglês, presa ao fato marcado)
              <textarea className="in" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="I read your case study on the headless e-commerce rebuild for…" />
            </label>
            {reason.trim() && selected.length === 0 && <Banner color="rd" icon="alert">Marque o fato verificado que sustenta o motivo.</Banner>}
            {preview.error && <ErrorBox error={preview.error} />}
            {preview.data && <MailPreview from={preview.data.from} to={preview.data.to} subject={preview.data.subject} body={preview.data.body} />}
            <div className="row" data-tour="personalize-save">
              {preview.data && <PersonalizationChip value={preview.data.personalization} />}
              <span className="sp" />
              <button className="bt" disabled={busy || locked || !data.inCampaign} onClick={() => save(false)}>
                Salvar como genérica
              </button>
              <button className="bt p" disabled={!canSave || !reason.trim()} onClick={() => save(true)}>
                Salvar personalizada
              </button>
            </div>
            <div className="mt">Nada é enviado aqui. O rascunho vai para a fila de revisão.</div>
          </div>
        </section>
      </div>
    </>
  );
};
