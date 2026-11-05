import { useEffect, useMemo, useRef, useState } from 'react';
import { campaignApi, type CampaignDetail, type Preview, useApi } from '../api';
import { Banner, Chip, Dialog, ErrorBox, Flag, Loading, MailPreview, PersonalizationChip, RateCard, StatusChip, statusLabel, useAction, useMeta } from '../components/ui';
import { brDateTime, pct, utcLabel } from '../format';
import { Link, navigate, useLocation } from '../router';

type Detail = CampaignDetail;
type StepState = 'done' | 'pending' | 'blocked';

const PLACEHOLDERS = ['{{contact.firstName}}', '{{company.name}}', '{{stack}}', '{{reason}}', '{{contact.name}}', '{{sender.name}}'];

// Line diff between two template versions (longest common subsequence; templates are short).
const diffLines = (before: string, after: string) => {
  const a = before.split('\n');
  const b = after.split('\n');
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const out: { kind: ' ' | '-' | '+'; line: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) (out.push({ kind: ' ', line: a[i]! }), i++, j++);
    else if (table[i + 1]![j]! >= table[i]![j + 1]!) out.push({ kind: '-', line: a[i++]! });
    else out.push({ kind: '+', line: b[j++]! });
  }
  while (i < a.length) out.push({ kind: '-', line: a[i++]! });
  while (j < b.length) out.push({ kind: '+', line: b[j++]! });
  return out.filter((item) => item.kind !== ' ');
};

const useDebounced = <T,>(value: T, ms = 400) => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
};

// ---------------------------------------------------------------- 2 · Templates

const Templates = ({ detail, reload }: { detail: Detail; reload: () => Promise<void> }) => {
  const { run, busy } = useAction();
  const name = detail.campaign.name;
  const [step, setStep] = useState(0);
  const versions = detail.templates.find((item) => item.step === step)?.versions ?? [];
  const latest = versions.at(-1);
  const [subject, setSubject] = useState(latest?.subject ?? '');
  const [body, setBody] = useState(latest?.body ?? '');
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    setSubject(latest?.subject ?? '');
    setBody(latest?.body ?? '');
  }, [latest?.id, step]);

  const companies = [
    ...detail.targets.map((target) => ({ domain: target.company.domain, name: target.company.name })),
    ...detail.candidates.map((candidate) => ({ domain: candidate.company.domain, name: candidate.company.name })),
  ];
  const [companyRef, setCompanyRef] = useState(companies[0]?.domain ?? '');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<{ data?: Preview; error?: string }>({});
  const input = useDebounced({ subject, body, companyRef, reason, step });
  useEffect(() => {
    if (!input.subject.trim() || !input.body.trim()) return setPreview({});
    let current = true;
    campaignApi
      .preview(name, { step: input.step, subject: input.subject, body: input.body, companyRef: input.companyRef || undefined, reason: input.reason || undefined })
      .then((data) => current && setPreview({ data }))
      .catch((error: Error) => current && setPreview({ error: error.message }));
    return () => {
      current = false;
    };
  }, [input, name]);

  const changed = subject !== (latest?.subject ?? '') || body !== (latest?.body ?? '');
  const insert = (placeholder: string) => {
    const element = bodyRef.current;
    if (!element) return setBody((value) => value + placeholder);
    const start = element.selectionStart;
    const next = body.slice(0, start) + placeholder + body.slice(element.selectionEnd);
    setBody(next);
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(start + placeholder.length, start + placeholder.length);
    });
  };
  const closed = detail.campaign.status === 'closed';

  return (
    <>
      <div className="grid2">
        <section className="cd" style={{ flex: '1 1 460px' }}>
          <div className="cdh">
            <h2 className="h">2 · Template</h2>
            <div className="row" style={{ gap: 4 }}>
              {detail.templates.map((item) => (
                <button key={item.step} className={`bt sm${step === item.step ? ' on' : ''}`} onClick={() => setStep(item.step)}>
                  Etapa {item.step} · {item.step === 0 ? 'primeiro contato' : `follow-up ${item.step}`}
                </button>
              ))}
            </div>
            <span className="sp" />
            {latest ? (
              <span className="mt">
                v{latest.version} {latest.approvedAt ? 'aprovada' : 'aguardando aprovação'}
              </span>
            ) : (
              <span className="mt">sem versão</span>
            )}
          </div>
          <div className="cdb" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label className="lb">
              Assunto
              <input className="in" value={subject} onChange={(event) => setSubject(event.target.value)} disabled={closed} placeholder="Extra {{stack}} capacity for {{company.name}}" />
            </label>
            <label className="lb">
              Corpo (inglês: é o que o destinatário recebe)
              <textarea ref={bodyRef} className="in mono" rows={12} value={body} onChange={(event) => setBody(event.target.value)} disabled={closed} />
            </label>
            <div className="row" style={{ gap: 4 }}>
              <span className="mt">Inserir:</span>
              {PLACEHOLDERS.map((placeholder) => (
                <button key={placeholder} className="bt sm mono" onClick={() => insert(placeholder)} disabled={closed}>
                  {placeholder}
                </button>
              ))}
            </div>
            <div className="mt">
              A linha com <span className="mono">{'{{reason}}'}</span> some quando não há fato verificado; a linha com <span className="mono">{'{{stack}}'}</span> some sem tecnologia em
              comum. O rodapé (nome, endereço postal e descadastro) é fixo e vem de Configurações.
            </div>
            <div className="row">
              <span className="sp" />
              <button
                className="bt"
                disabled={busy || closed || !changed || !subject.trim() || !body.trim()}
                onClick={() => run(() => campaignApi.saveTemplate(name, step, subject, body), { success: 'Nova versão salva. Ela precisa de aprovação.', reload: [reload] })}
              >
                Salvar como nova versão
              </button>
              <button
                className="bt p"
                disabled={busy || closed || changed || !latest || !!latest.approvedAt}
                title={changed ? 'Salve as alterações antes de aprovar' : undefined}
                onClick={() => run(() => campaignApi.approveTemplate(name, step), { success: `Template v${latest!.version} da etapa ${step} aprovado.`, reload: [reload] })}
              >
                Aprovar v{latest?.version ?? '–'}
              </button>
            </div>
          </div>
        </section>

        <section className="cd" style={{ flex: '1 1 420px' }}>
          <div className="cdh">
            <h2 className="h">Preview com empresa real</h2>
            <span className="sp" />
            <select className="in" value={companyRef} onChange={(event) => setCompanyRef(event.target.value)}>
              <option value="">Exemplo fictício</option>
              {companies.map((company) => (
                <option key={company.domain} value={company.domain}>
                  {company.name}
                </option>
              ))}
            </select>
          </div>
          <div className="cdb" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label className="lb">
              Motivo de teste (opcional, para ver a linha {'{{reason}}'})
              <input className="in" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="I read your case study on…" />
            </label>
            {preview.error && <ErrorBox error={preview.error} />}
            {preview.data && (
              <>
                <MailPreview from={preview.data.from} to={preview.data.to} subject={preview.data.subject} body={preview.data.body} />
                <div className="row" style={{ gap: 6 }}>
                  <PersonalizationChip value={preview.data.personalization} />
                  {preview.data.personalization === 'generic' && <span className="mt">Sem motivo: a linha {'{{reason}}'} foi removida.</span>}
                </div>
              </>
            )}
          </div>
        </section>
      </div>

      <section className="cd">
        <div className="cdh">
          <h2 className="h">Versões da etapa {step}</h2>
          <span className="mt">Cada versão nova precisa de aprovação. Mensagens já aprovadas mantêm o texto que foi aprovado.</span>
        </div>
        {versions.length === 0 && <div className="cdb mt">Nenhuma versão ainda. Os modelos em templates/first.txt e templates/follow-up.txt são um bom começo.</div>}
        {[...versions].reverse().map((version, index, list) => {
          const previous = list[index + 1];
          const changes = previous ? diffLines(`${previous.subject}\n${previous.body}`, `${version.subject}\n${version.body}`) : [];
          return (
            <div key={version.id} className="li" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
              <div className="row" style={{ gap: 8 }}>
                <span className="mono">v{version.version}</span>
                <StatusChip status={version.approvedAt ? 'approved' : 'draft'} />
                <span className="mt" title={utcLabel(version.createdAt)}>
                  criada {brDateTime(version.createdAt)}
                  {version.approvedAt ? ` · aprovada ${brDateTime(version.approvedAt)}` : ''}
                </span>
              </div>
              {changes.length > 0 && (
                <div style={{ border: '1px solid var(--ln)', borderRadius: 6, overflow: 'hidden' }}>
                  {changes.map((change, position) => (
                    <div key={position} className={`dl ${change.kind === '+' ? 'a' : 'r'}`}>
                      {change.kind} {change.line || ' '}
                    </div>
                  ))}
                </div>
              )}
              {!previous && <span className="mt">primeira versão</span>}
            </div>
          );
        })}
      </section>
    </>
  );
};

// ---------------------------------------------------------------- 4 · Seleção

const Selection = ({ detail, reload }: { detail: Detail; reload: () => Promise<void> }) => {
  const { run, busy } = useAction();
  const name = detail.campaign.name;
  const eligible = detail.candidates.filter((candidate) => !candidate.reason);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [auto, setAuto] = useState({ country: detail.campaign.market ?? '', priority: '', limit: '10' });
  const [result, setResult] = useState<{ added: number; skipped: { name: string; reason: string }[] } | null>(null);
  const toggle = (domain: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });

  const addPicked = () =>
    run(
      async () => {
        const skipped: { name: string; reason: string }[] = [];
        let added = 0;
        for (const domain of picked) {
          try {
            await campaignApi.addTarget(name, domain);
            added++;
          } catch (error) {
            skipped.push({ name: domain, reason: (error as Error).message });
          }
        }
        setPicked(new Set());
        setResult({ added, skipped });
      },
      { reload: [reload] },
    );

  const autoSelect = () =>
    run(
      async () => {
        const response = await campaignApi.select(name, {
          countries: auto.country ? [auto.country] : undefined,
          priority: auto.priority || undefined,
          limit: auto.limit ? Number(auto.limit) : undefined,
        });
        setResult({ added: response.added.length, skipped: response.skipped });
      },
      { reload: [reload] },
    );

  return (
    <section className="cd">
      <div className="cdh">
        <h2 className="h">4 · Selecionar empresas</h2>
        <span className="mt">Só qualified, com contato apto e fora de outra campanha aberta. Uma empresa entra com um único contato.</span>
      </div>
      <div className="cdb row" style={{ alignItems: 'flex-end', borderBottom: '1px solid var(--ln)' }}>
        <label className="lb">
          País
          <select className="in" value={auto.country} onChange={(event) => setAuto({ ...auto, country: event.target.value })}>
            <option value="">Todos</option>
            {['GB', 'US', 'CA', 'IE', 'AU'].map((code) => (
              <option key={code}>{code}</option>
            ))}
          </select>
        </label>
        <label className="lb">
          Prioridade
          <select className="in" value={auto.priority} onChange={(event) => setAuto({ ...auto, priority: event.target.value })}>
            <option value="">Todas</option>
            <option value="high">Alta</option>
            <option value="medium">Média</option>
            <option value="low">Baixa</option>
          </select>
        </label>
        <label className="lb">
          Limite
          <input className="in" style={{ width: 80 }} inputMode="numeric" value={auto.limit} onChange={(event) => setAuto({ ...auto, limit: event.target.value })} />
        </label>
        <button className="bt" disabled={busy || eligible.length === 0} onClick={autoSelect}>
          Selecionar automaticamente
        </button>
        <span className="mt">ou marque na tabela abaixo.</span>
      </div>
      {result && (
        <div className="cdb">
          <Banner color={result.skipped.length ? 'am' : 'gn'} icon={result.skipped.length ? 'warn' : 'info'}>
            {result.added} adicionada(s).
            {result.skipped.map((item) => (
              <div key={item.name}>
                <span className="mono">{item.name}</span>: {item.reason}
              </div>
            ))}
          </Banner>
        </div>
      )}
      <div className="tbw" style={{ border: 0, borderRadius: 0 }}>
        <table className="tb">
          <thead>
            <tr>
              <th scope="col" />
              <th scope="col">Empresa</th>
              <th scope="col">Contato</th>
              <th scope="col">Prior.</th>
              <th scope="col">Pontuação</th>
              <th scope="col">Situação</th>
            </tr>
          </thead>
          <tbody>
            {detail.candidates.length === 0 && (
              <tr>
                <td colSpan={6} className="mt">
                  Nenhuma empresa qualified fora de campanha. Qualifique mais empresas em Empresas.
                </td>
              </tr>
            )}
            {detail.candidates.map((candidate) => (
              <tr key={candidate.company.id}>
                <td>
                  <input type="checkbox" disabled={!!candidate.reason} checked={picked.has(candidate.company.domain)} onChange={() => toggle(candidate.company.domain)} />
                </td>
                <td>
                  <Flag country={candidate.company.country} />
                  <Link className="nm" to={`/empresas/${candidate.company.domain}`}>
                    {candidate.company.name}
                  </Link>
                </td>
                <td>{candidate.contact ? `${candidate.contact.name}${candidate.contact.role ? ` · ${candidate.contact.role}` : ''}` : <span className="mt">sem contato apto</span>}</td>
                <td className="mt">{candidate.company.priority ?? '—'}</td>
                <td className="mono">{candidate.company.qualification ? pct(candidate.company.qualification.score / candidate.company.qualification.maxScore) : '—'}</td>
                <td>
                  {candidate.reason ? (
                    <Chip color="rd" dot={false}>
                      {candidate.reason}
                    </Chip>
                  ) : candidate.outsideMarket ? (
                    <Chip color="am" dot={false}>
                      elegível · fora do mercado {detail.campaign.market}
                    </Chip>
                  ) : (
                    <Chip color="gn" dot={false}>
                      elegível
                    </Chip>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="cdb row">
        <span className="sp" />
        <button className="bt p" disabled={busy || picked.size === 0} onClick={addPicked}>
          Adicionar {picked.size} selecionada{picked.size === 1 ? '' : 's'}
        </button>
      </div>
    </section>
  );
};

// ---------------------------------------------------------------- 5 · Rascunhos

const Drafts = ({ detail, reload }: { detail: Detail; reload: () => Promise<void> }) => {
  const { run, busy } = useAction();
  const name = detail.campaign.name;
  const [skipped, setSkipped] = useState<{ company: string; reason: string }[]>([]);
  const missing = detail.targets.filter((target) => !target.messages.some((message) => message.step === 0));
  return (
    <section className="cd">
      <div className="cdh">
        <h2 className="h">5 · Rascunhos</h2>
        <span className="mt">Genérica é marcada como genérica; personalizar exige um fato verificado.</span>
        <span className="sp" />
        <button
          className="bt"
          disabled={busy || missing.length === 0}
          onClick={() =>
            run(
              async () => {
                const result = await campaignApi.draftAll(name);
                setSkipped(result.skipped);
                return result;
              },
              { success: 'Rascunhos genéricos gerados para quem não tinha.', reload: [reload] },
            )
          }
        >
          Gerar genéricos para {missing.length} sem rascunho
        </button>
      </div>
      {skipped.length > 0 && (
        <div className="cdb">
          <Banner color="am" icon="warn">
            {skipped.map((item) => (
              <div key={item.company}>
                <span className="mono">{item.company}</span>: {item.reason}
              </div>
            ))}
          </Banner>
        </div>
      )}
      {detail.targets.length === 0 && <div className="cdb mt">Nenhuma empresa na campanha ainda. Volte à etapa 4.</div>}
      {detail.targets.map((target) => {
        const first = target.messages.find((message) => message.step === 0);
        const editable = !first || first.status === 'draft' || first.status === 'approved';
        return (
          <div className="li" key={target.company.id}>
            <Link className="nm" to={`/empresas/${target.company.domain}`} style={{ flex: '0 0 200px' }}>
              {target.company.name}
            </Link>
            <span className="mt" style={{ flex: '1 1 200px' }}>
              {target.contact?.name}
              {target.contact?.role ? ` · ${target.contact.role}` : ''}
              {target.contact?.blockReason ? ` · bloqueado: ${target.contact.blockReason}` : ''}
            </span>
            {target.messages.map((message) => (
              <span key={message.id} className="row" style={{ gap: 4 }}>
                <span className="mt">etapa {message.step}</span>
                <StatusChip status={message.status} />
              </span>
            ))}
            {first ? <PersonalizationChip value={first.personalization} /> : <span className="mt">sem rascunho</span>}
            {editable && detail.campaign.status !== 'closed' && (
              <Link className="bt sm" to={`/campanhas/${encodeURIComponent(name)}/personalizar/${target.company.domain}`}>
                {first?.personalization === 'evidence_based' ? 'Editar motivo' : 'Personalizar'}
              </Link>
            )}
          </div>
        );
      })}
    </section>
  );
};

// ---------------------------------------------------------------- Página

export const CampaignPage = ({ name }: { name: string }) => {
  const meta = useMeta().data!;
  const { query } = useLocation();
  const { data, error, reload } = useApi<Detail>(`/api/campaigns/${encodeURIComponent(name)}`);
  const { run, busy } = useAction();
  const [closing, setClosing] = useState(false);
  const stepParam = Number(query.get('etapa') ?? '');

  const steps = useMemo(() => {
    if (!data) return [];
    const { campaign, templates, targets, metrics } = data;
    const latest0 = templates[0]?.versions.at(-1);
    const latest1 = templates[1]?.versions.at(-1);
    const templatesOk = !!latest0?.approvedAt && (!latest1 || !!latest1.approvedAt);
    const active = campaign.status === 'active';
    const allDrafted = targets.length > 0 && targets.every((target) => target.messages.some((message) => message.step === 0));
    const list: { n: number; label: string; state: StepState; note: string }[] = [
      { n: 1, label: 'Criar', state: 'done', note: campaign.market ? `mercado ${campaign.market}` : 'sem mercado' },
      { n: 2, label: 'Templates', state: templatesOk ? 'done' : 'pending', note: latest0 ? (templatesOk ? 'aprovados' : 'versão aguardando aprovação') : 'escreva a etapa 0' },
      {
        n: 3,
        label: 'Ativar',
        state: campaign.status === 'draft' ? (latest0?.approvedAt ? 'pending' : 'blocked') : 'done',
        note: campaign.status === 'draft' ? (latest0?.approvedAt ? 'aprovação humana' : 'aprove a etapa 0') : statusLabel(campaign.status).toLowerCase(),
      },
      { n: 4, label: 'Selecionar', state: campaign.status === 'closed' ? 'blocked' : targets.length ? 'done' : 'pending', note: `${targets.length} empresa(s)` },
      { n: 5, label: 'Rascunhos', state: !targets.length || !latest0?.approvedAt ? 'blocked' : allDrafted ? 'done' : 'pending', note: `${metrics.drafts} rascunho(s)` },
      { n: 6, label: 'Revisão', state: metrics.drafts ? 'pending' : metrics.approved + metrics.sent ? 'done' : 'blocked', note: `${metrics.drafts} na fila` },
      { n: 7, label: 'Envio', state: !active ? 'blocked' : metrics.approved ? 'pending' : metrics.sent ? 'done' : 'blocked', note: `${metrics.approved} aprovada(s) · ${metrics.sent} enviada(s)` },
    ];
    return list;
  }, [data]);

  const firstPending = steps.find((step) => step.state === 'pending')?.n ?? 2;
  const current = stepParam >= 1 && stepParam <= 7 ? stepParam : firstPending;
  const go = (n: number) => navigate(`/campanhas/${encodeURIComponent(name)}?etapa=${n}`, { replace: true });

  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const { campaign, metrics } = data;
  const latest0 = data.templates[0]?.versions.at(-1);

  return (
    <>
      <div className="row">
        <div>
          <Link className="mt" to="/campanhas">
            ← Campanhas
          </Link>
          <div className="row" style={{ gap: 10 }}>
            <h1 className="t mono">{campaign.name}</h1>
            <StatusChip status={campaign.status} />
          </div>
          <div className="sub">
            {[campaign.market && `mercado ${campaign.market}`, campaign.segment, campaign.criteria].filter(Boolean).join(' · ') || 'sem critérios registrados'}
          </div>
        </div>
        <span className="sp" />
        <span className="row" style={{ gap: 12 }} data-tour="campaign-actions">
        {campaign.status === 'active' && (
          <button className="bt" disabled={busy} onClick={() => run(() => campaignApi.pause(name), { success: 'Campanha pausada: nada é enviado até retomar.', reload: [reload] })}>
            Pausar
          </button>
        )}
        {campaign.status === 'paused' && (
          <button className="bt" disabled={busy} onClick={() => run(() => campaignApi.activate(name), { success: 'Campanha retomada.', reload: [reload] })}>
            Retomar
          </button>
        )}
        {campaign.status !== 'closed' && (
          <button className="bt dn" onClick={() => setClosing(true)}>
            Encerrar
          </button>
        )}
        </span>
      </div>

      <div className="stz" data-tour="campaign-steps">
        {steps.map((step) => (
          <button key={step.n} className={`stc${current === step.n ? ' sel' : ''}`} onClick={() => go(step.n)}>
            <span className="row" style={{ gap: 6 }}>
              <span className={`n ${step.state === 'done' ? 'gn' : step.state === 'pending' ? 'bl' : 'gy'}`}>{step.n}</span>
              <b>{step.label}</b>
            </span>
            <span className={`ch ${step.state === 'done' ? 'gn' : step.state === 'pending' ? 'bl' : 'gy'} nd`}>
              {step.state === 'done' ? 'concluída' : step.state === 'pending' ? 'pendente' : 'bloqueada'}
            </span>
            <span className="mt">{step.note}</span>
          </button>
        ))}
      </div>

      {campaign.status === 'closed' && <Banner color="gy">Campanha encerrada: nada mais é editado ou enviado. O histórico e as métricas continuam disponíveis.</Banner>}

      {current === 1 && (
        <section className="cd">
          <div className="cdh">
            <h2 className="h">1 · Criar</h2>
            <Chip color="gn" dot={false}>
              concluída
            </Chip>
          </div>
          <dl className="kv cdb" style={{ margin: 0 }}>
            <dt>Nome</dt>
            <dd className="mono">{campaign.name}</dd>
            <dt>Mercado</dt>
            <dd>{campaign.market ?? '—'}</dd>
            <dt>Segmento</dt>
            <dd>{campaign.segment ?? '—'}</dd>
            <dt>Critérios</dt>
            <dd>{campaign.criteria ?? '—'}</dd>
            <dt>Notas</dt>
            <dd>{campaign.notes ?? '—'}</dd>
            <dt>Criada</dt>
            <dd title={utcLabel(campaign.createdAt)}>{brDateTime(campaign.createdAt, true)}</dd>
            {campaign.approvedAt && (
              <>
                <dt>Ativada (aprovação)</dt>
                <dd title={utcLabel(campaign.approvedAt)}>{brDateTime(campaign.approvedAt, true)}</dd>
              </>
            )}
          </dl>
        </section>
      )}

      {current === 2 && <Templates detail={data} reload={reload} />}

      {current === 3 && (
        <section className="cd">
          <div className="cdh">
            <h2 className="h">3 · Ativar campanha</h2>
            <span className="mt">Ativar é a sua aprovação humana: depois disso, mensagens aprovadas podem ser enviadas.</span>
          </div>
          <div className="cdb" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {data.templates.map((item) => {
              const last = item.versions.at(-1);
              return (
                <div className="row" key={item.step} style={{ gap: 8 }}>
                  <Chip color={last?.approvedAt ? 'gn' : last ? 'am' : 'gy'} dot={false}>
                    {last ? `v${last.version} ${last.approvedAt ? 'aprovada' : 'sem aprovação'}` : 'sem template'}
                  </Chip>
                  <span>Template da etapa {item.step}</span>
                  {item.step >= 1 && !last && <span className="mt">(opcional; sem ele não há esse follow-up)</span>}
                </div>
              );
            })}
            <div className="row" style={{ gap: 8 }}>
              <Chip color={data.sender.configured ? 'gn' : 'rd'} dot={false}>
                {data.sender.configured ? 'configurado' : 'incompleto'}
              </Chip>
              <span>
                Remetente: {data.sender.name || '—'} &lt;{data.sender.email || '—'}&gt; · endereço postal {data.sender.postalAddress ? 'presente' : 'ausente'}
              </span>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <Chip color={data.transport === 'smtp' ? 'am' : 'bl'} dot={false}>
                {data.transport}
              </Chip>
              <span>{data.transport === 'smtp' ? 'Envio real: os e-mails chegam aos destinatários.' : 'Transporte em simulação: nada sai da máquina.'}</span>
            </div>
            {!latest0?.approvedAt && (
              <Banner color="rd" icon="alert">
                <b>Não dá para ativar:</b> aprove o template da etapa 0 primeiro (etapa 2).
              </Banner>
            )}
            {!data.sender.configured && (
              <Banner color="am" icon="warn">
                Sem SENDER_NAME, SENDER_EMAIL e SENDER_POSTAL_ADDRESS no .env os rascunhos não são gerados (o rodapé exige esses dados).
              </Banner>
            )}
            <div>
              {campaign.status === 'draft' ? (
                <button className="bt p" disabled={busy || !latest0?.approvedAt} onClick={() => run(() => campaignApi.activate(name), { success: 'Campanha ativada.', reload: [reload] })}>
                  Aprovar e ativar campanha
                </button>
              ) : (
                <span className="mt">Campanha {statusLabel(campaign.status).toLowerCase()}.</span>
              )}
            </div>
          </div>
        </section>
      )}

      {current === 4 && <Selection detail={data} reload={reload} />}
      {current === 5 && <Drafts detail={data} reload={reload} />}

      {current === 6 && (
        <section className="cd">
          <div className="cdh">
            <h2 className="h">6 · Revisão</h2>
          </div>
          <div className="cdb row">
            <span style={{ flex: 1 }}>
              {metrics.drafts ? `${metrics.drafts} rascunho(s) aguardando revisão. Aprovar trava o conteúdo por hash.` : 'Nenhum rascunho na fila.'}
            </span>
            <Link className="bt p" to={`/revisao?campanha=${encodeURIComponent(name)}`}>
              Abrir fila de revisão
            </Link>
          </div>
        </section>
      )}

      {current === 7 && (
        <section className="cd">
          <div className="cdh">
            <h2 className="h">7 · Envio</h2>
          </div>
          <div className="cdb row">
            <span style={{ flex: 1 }}>
              {campaign.status !== 'active'
                ? `A campanha está ${statusLabel(campaign.status).toLowerCase()}; envio só com campanha ativa.`
                : `${metrics.approved} mensagem(ns) aprovada(s). Hoje: ${meta.sentToday}/${meta.sending.dailyLimit} envios.`}
            </span>
            <Link className="bt p" to={`/envio?campanha=${encodeURIComponent(name)}`}>
              Simular envio
            </Link>
          </div>
        </section>
      )}

      <section className="cd" data-tour="campaign-metrics">
        <div className="cdh">
          <h2 className="h">Métricas da campanha</h2>
          <span className="mt">Cada taxa mostra numerador, denominador e definição</span>
        </div>
        <div className="cdb" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 16 }}>
          {metrics.rates.map((rate) => (
            <RateCard key={rate.name} rate={rate} />
          ))}
          <div>
            <div className="mono" style={{ fontSize: 20 }}>
              {metrics.sent}
            </div>
            <div className="mt">Enviadas</div>
          </div>
          <div>
            <div className="mono" style={{ fontSize: 20 }}>
              {metrics.failed} · {metrics.unknown}
            </div>
            <div className="mt">Falhas · desconhecidas</div>
          </div>
        </div>
        {metrics.warnings.length > 0 && (
          <div className="cdb" style={{ borderTop: '1px solid var(--ln)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {metrics.warnings.map((warning) => (
              <div className="bn am" key={warning}>
                {warning}
              </div>
            ))}
          </div>
        )}
      </section>

      {closing && (
        <Dialog label="Encerrar campanha" onClose={() => setClosing(false)}>
          <h2 className="h" style={{ fontSize: 17 }}>
            Encerrar {campaign.name}?
          </h2>
          <div>
            Uma campanha encerrada não volta. Rascunhos e aprovadas deixam de ser enviados e as empresas ficam livres para outra campanha. O histórico continua.
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="bt" onClick={() => setClosing(false)}>
              Cancelar
            </button>
            <button
              className="bt dn"
              disabled={busy}
              onClick={async () => {
                await run(() => campaignApi.close(name), { success: 'Campanha encerrada.', reload: [reload] });
                setClosing(false);
              }}
            >
              Encerrar campanha
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
};
