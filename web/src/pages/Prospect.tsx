import { useEffect, useState } from 'react';
import {
  api,
  companyApi,
  type DiscoverReport,
  type ProspectFunnel,
  type ProspectJob,
  type ProspectRun,
  type ProspectSearch,
  type ProspectStatus,
  prospectApi,
  type ReviewKind,
  useApi,
} from '../api';
import { Banner, Chip, Dialog, ErrorBox, Loading, useAction, useMeta, useToast } from '../components/ui';
import { relativeTime, utcLabel } from '../format';
import { Link } from '../router';

const COUNTRIES = [
  ['US', 'Estados Unidos'],
  ['GB', 'Reino Unido'],
  ['IE', 'Irlanda'],
  ['CA', 'Canadá'],
  ['AU', 'Austrália'],
  ['BR', 'Brasil'],
] as const;

const LOW_CREDITS = 10;

// "bedrock us.anthropic.claude-haiku-4-5-20251001-v1:0" -> "Haiku 4.5"; the full id stays in the tooltip.
const modelLabel = (name?: string): string => {
  const found = name?.match(/claude-([a-z]+)-(\d+)-(\d+)/);
  return found ? `${found[1]![0]!.toUpperCase()}${found[1]!.slice(1)} ${found[2]}.${found[3]}` : (name ?? '—');
};

const REVIEW_GROUPS: { kinds: ReviewKind[]; title: string; hint: string; color: string }[] = [
  { kinds: ['unclear'], title: 'Precisam do seu julgamento', hint: 'A IA leu, mas não deu para confirmar', color: 'am' },
  { kinds: ['failed'], title: 'Falharam ao carregar', hint: 'Lentidão ou erro do servidor: vale tentar de novo, é grátis', color: 'gy' },
  { kinds: ['javascript'], title: 'Site em JavaScript', hint: 'Tentar de novo é grátis, mas raramente resolve: o leitor não executa JavaScript', color: 'gy' },
  { kinds: ['blocked'], title: 'Bloqueado para robôs', hint: 'Só abrindo o site você decide', color: 'gy' },
];

const REVIEW_TEXT: Record<ReviewKind, { reason: string; chip: string; color: string; detail?: string }> = {
  unclear: { reason: 'A IA não conseguiu citar o site', chip: 'Sem decisão', color: 'am' },
  failed: { reason: 'O site não respondeu a tempo ou deu erro', chip: 'Site não lido', color: 'gy' },
  javascript: { reason: 'Sem texto legível: o site é montado por JavaScript', chip: 'Site não lido', color: 'gy' },
  blocked: { reason: 'Bloqueado para robôs', chip: 'Site não lido', color: 'gy', detail: 'Tentar de novo não resolve: o site recusa robôs. Abra e decida à mão.' },
};

const RETRYABLE = new Set<ReviewKind>(['failed', 'javascript']);

const DISCARD_REASONS = ['Fora do perfil', 'Não é software house', 'Site inacessível e sem outra fonte', 'Outro'];

const SummaryRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="row">
    <span className="mt">{label}</span>
    <span className="sp" />
    {children}
  </div>
);

const RunRow = ({ run, live }: { run: ProspectRun; live?: boolean }) => (
  <tr>
    <td className="mt" title={utcLabel(run.startedAt)} style={{ whiteSpace: 'nowrap' }}>
      {relativeTime(run.startedAt)}
    </td>
    <td>
      {run.label}{' '}
      {live && <Chip color="bl">rodando</Chip>}
      {run.status === 'stopped' && <Chip color="gy">interrompida</Chip>}
      {run.status === 'failed' && (
        <Chip color="rd" title={run.error}>
          falhou
        </Chip>
      )}
    </td>
    <td className="mono">{run.read}</td>
    <td className="mono">
      {run.qualified > 0 ? (
        <Link to="/empresas?status=qualified" style={{ textDecoration: 'underline' }}>
          {run.qualified}
        </Link>
      ) : (
        run.qualified
      )}{' '}
      / {run.read}
    </td>
    <td className="mono">{run.review}</td>
    <td className="mono">{run.discarded}</td>
    <td className="mono">{run.creditCap === undefined ? '—' : `${run.creditsSpent} de ${run.creditCap}`}</td>
  </tr>
);

// The run in progress, shaped like a history row so the table updates in place.
const liveRun = (job: ProspectJob): ProspectRun => ({
  id: job.id,
  mode: job.mode,
  label: job.label,
  status: job.status,
  startedAt: job.startedAt,
  read: job.qualified.length,
  qualified: job.qualified.filter((item) => item.outcome === 'qualified').length,
  review: job.qualified.filter((item) => item.outcome === 'unclear' || item.outcome === 'unreachable').length,
  discarded: job.qualified.filter((item) => item.outcome === 'disqualified').length,
  creditsSpent: job.spentCredits,
  creditCap: job.creditCap,
});

const useJob = (onFinished: () => void) => {
  const current = useApi<ProspectJob | null>('/api/prospect/job');
  const [job, setJob] = useState<ProspectJob | null>(null);
  useEffect(() => {
    if (current.data && !job) setJob(current.data);
  }, [current.data]);
  const running = job?.status === 'running';
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(async () => {
      try {
        const next = await api.get<ProspectJob | null>('/api/prospect/job');
        if (!next) return;
        setJob(next);
        if (next.status !== 'running') onFinished();
      } catch {
        /* keep polling */
      }
    }, 1500);
    return () => window.clearInterval(id);
  }, [running]);
  return { job, setJob, running };
};

export const ProspectPage = () => {
  const status = useApi<ProspectStatus>('/api/prospect');
  const meta = useMeta();
  const toast = useToast();
  const { run, busy } = useAction();
  const { job, setJob, running } = useJob(() => {
    void status.reload();
    void meta.reload();
    toast('Busca terminada. Veja o histórico e o que ficou para revisar.');
  });
  const [form, setForm] = useState({ country: 'BR', state: '', city: '', headcount: ['11-50', '51-200'], keywords: '', limit: 20 });
  const [advanced, setAdvanced] = useState(false);
  const [funnel, setFunnel] = useState<ProspectFunnel>({ contacts: true, maxCredits: 5, perCompany: 2 });
  const [preview, setPreview] = useState<DiscoverReport | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [discard, setDiscard] = useState<{ domains: string[]; what: string } | null>(null);
  const [reason, setReason] = useState('');
  const [otherReason, setOtherReason] = useState('');

  if (status.error && !status.data) return <ErrorBox error={status.error} onRetry={status.reload} />;
  if (!status.data) return <Loading />;
  const { hunter, ai, pending, review, runs, defaults } = status.data;
  const credits = hunter.credits ?? 0;
  const contacts = funnel.contacts && hunter.configured;
  const cap = contacts ? funnel.maxCredits : 0;

  const set = (patch: Partial<typeof form>) => (setForm({ ...form, ...patch }), setPreview(null));
  const setF = (patch: Partial<ProspectFunnel>) => (setFunnel({ ...funnel, ...patch }), setPreview(null));
  const toInt = (value: string, min: number, max: number) => Math.max(min, Math.min(max, Number.parseInt(value, 10) || min));
  const search = (): ProspectSearch => ({
    country: form.country,
    state: form.country === 'US' ? form.state.trim() || undefined : undefined,
    city: form.city.trim() || undefined,
    headcount: form.headcount,
    keywords: form.keywords.split(',').map((item) => item.trim()).filter(Boolean),
    limit: form.limit,
  });

  const warn = !hunter.configured
    ? 'Hunter não configurado: defina HUNTER_API_KEY no .env e reinicie a API.'
    : !ai.configured
      ? 'IA não configurada: defina AWS_BEARER_TOKEN_BEDROCK no .env e reinicie a API.'
      : contacts && cap > credits
        ? `Teto de ${cap} maior que o saldo de ${credits}. Reduza o teto.`
        : form.headcount.length === 0
          ? 'Escolha pelo menos um tamanho.'
          : form.country === 'US' && form.city.trim() && !form.state.trim()
            ? 'Nos EUA o Hunter exige o estado junto com a cidade.'
            : '';
  const found = preview ? preview.imported.length + preview.alreadyKnown.length + preview.suppressed.length + preview.noContacts.length + preview.failed.length : 0;

  const doPreview = async () => {
    const report = await run(() => prospectApi.preview(search()));
    if (report) setPreview(report);
  };
  const startJob = async (work: () => Promise<ProspectJob>, message: string) => {
    const started = await run(work);
    if (!started) return;
    setJob(started);
    setPreview(null);
    setSelected(new Set());
    toast(message);
  };
  const retry = (domains: string[]) =>
    startJob(() => prospectApi.retry(domains, { ...funnel, contacts }), `${domains.length === 1 ? domains[0] : `${domains.length} empresas`} na fila. Grátis; o resultado volta para esta lista.`);

  const groups = REVIEW_GROUPS.map((group) => ({ ...group, items: review.filter((item) => group.kinds.includes(item.kind)) })).filter((group) => group.items.length);
  const selectedItems = review.filter((item) => selected.has(item.company.domain));
  const retryable = selectedItems.filter((item) => RETRYABLE.has(item.kind)).map((item) => item.company.domain);
  const flip = (domain: string) => setSelected((previous) => {
    const next = new Set(previous);
    if (next.has(domain)) next.delete(domain);
    else next.add(domain);
    return next;
  });
  const history = job && running ? [liveRun(job), ...runs.filter((item) => item.id !== job.id)] : runs;
  const discardReason = reason === 'Outro' ? otherReason.trim() : reason;

  return (
    <>
      <div className="row">
        <div>
          <h1 className="t">Descoberta</h1>
          <div className="sub">Encontre empresas por região, deixe a IA ler o site e revise só o que ela não conseguiu decidir.</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }} data-tour="prospect-status">
        <section className="cd">
          <div className="cdb">
            <div className="row" style={{ gap: 6 }}>
              <span className="mt">Créditos Hunter</span>
              {hunter.configured && credits < LOW_CREDITS && <Chip color="am">acabando</Chip>}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 28, fontWeight: 600, lineHeight: 1.2 }}>{hunter.credits ?? '—'}</span>
              <span className="mt">{hunter.configured ? 'restantes' : 'sem chave'}</span>
            </div>
            <div className="mt">{hunter.error ?? `Gastam só na busca de decisores, 1 por empresa com resultado. Aviso quando restarem menos de ${LOW_CREDITS}.`}</div>
          </div>
        </section>
        <section className="cd">
          <div className="cdb">
            <div className="mt">Qualificação por IA</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginTop: 4 }} title={ai.model}>
              {ai.configured ? modelLabel(ai.model) : 'não configurada'}
            </div>
            <div className="mt">Cita o trecho do site. Sem citação conferida, a empresa vai para revisão e nada é decidido sozinho.</div>
          </div>
        </section>
        <section className="cd" data-tour="prospect-pending">
          <div className="cdb">
            <div className="mt">Aguardando a IA</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 28, fontWeight: 600, lineHeight: 1.2 }}>{pending}</span>
              <span className="mt">empresa{pending === 1 ? '' : 's'} na base</span>
            </div>
            <div className="mt">Ainda sem veredito, incluindo sites que falharam antes. Tentar de novo é grátis.</div>
            <button
              className="bt sm"
              style={{ marginTop: 6 }}
              disabled={busy || running || pending === 0 || !ai.configured}
              onClick={() => startJob(() => prospectApi.pending({ ...funnel, contacts }), `${pending} empresa(s) enviadas à IA. Resultados caem em Para revisar e no histórico.`)}
            >
              Qualificar pendentes
            </button>
          </div>
        </section>
      </div>

      {running && job && (
        <Banner color="bl" icon="info">
          <div className="row" style={{ gap: 10 }}>
            <span>
              <b>{job.stopRequested ? 'Interrompendo após a empresa atual…' : 'Prospectando'}</b> · {job.label} · {job.qualified.length} de {job.total ?? '…'} lida(s)
              {job.findsContacts ? ` · ${job.spentCredits} crédito(s)` : ''}
            </span>
            {!job.stopRequested && (
              <button className="bt sm" onClick={async () => setJob((await prospectApi.stop()) ?? job)}>
                Interromper com segurança
              </button>
            )}
          </div>
        </Banner>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        <section className="cd" style={{ flex: '1 1 560px', minWidth: 0 }} data-tour="prospect-form">
          <div className="cdh">
            <h2 className="h">1 · Onde procurar</h2>
          </div>
          <div className="cdb" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px,1fr) 90px minmax(140px,1.4fr) 110px', gap: 10 }}>
              <label className="lb">
                País
                <select className="in" value={form.country} onChange={(event) => set({ country: event.target.value, state: event.target.value === 'US' ? 'NY' : '' })}>
                  {COUNTRIES.map(([code, label]) => (
                    <option key={code} value={code}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="lb">
                Estado
                <input
                  className="in mono"
                  value={form.state}
                  maxLength={3}
                  disabled={form.country !== 'US'}
                  placeholder={form.country === 'US' ? 'NY' : '—'}
                  title={form.country === 'US' ? 'Sigla do estado; obrigatória com cidade' : 'Só nos EUA'}
                  onChange={(event) => set({ state: event.target.value.toUpperCase() })}
                />
              </label>
              <label className="lb">
                Cidade (opcional)
                <input className="in" value={form.city} placeholder={form.country === 'US' ? 'New York' : 'London'} onChange={(event) => set({ city: event.target.value })} />
              </label>
              <label className="lb">
                Máx. empresas
                <input className="in" type="number" min={1} max={100} value={form.limit} onChange={(event) => set({ limit: toInt(event.target.value, 1, 100) })} />
              </label>
            </div>
            <div className="lb">
              Tamanho (funcionários)
              <div className="row" style={{ gap: 6 }}>
                {defaults.headcounts.map((size) => {
                  const on = form.headcount.includes(size);
                  return (
                    <button
                      key={size}
                      className={`bt sm${on ? ' on' : ''}`}
                      aria-pressed={on}
                      onClick={() => set({ headcount: on ? form.headcount.filter((item) => item !== size) : [...form.headcount, size] })}
                    >
                      {on ? '✓ ' : ''}
                      {size}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <button className="bt sm gh" onClick={() => setAdvanced(!advanced)}>
                {advanced ? '− Ocultar avançado' : '+ Avançado: palavras-chave'}
              </button>
              {advanced && (
                <label className="lb" style={{ marginTop: 8 }}>
                  Palavras-chave, separadas por vírgula
                  <input className="in" value={form.keywords} placeholder={defaults.keywords.join(', ')} onChange={(event) => set({ keywords: event.target.value })} />
                  <span className="mt" style={{ fontWeight: 400 }}>
                    Vazio usa o padrão de software house.
                  </span>
                </label>
              )}
            </div>
          </div>
        </section>

        <div style={{ flex: '0 1 360px', minWidth: 300, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <section className="cd" data-tour="prospect-credits">
            <div className="cdh">
              <h2 className="h">2 · Decisores</h2>
              <span className="sp" />
              <Chip color={contacts ? 'am' : 'gy'} dot={false}>
                {contacts ? 'gasta crédito' : 'desligado'}
              </Chip>
            </div>
            <div className="cdb" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: hunter.configured ? 'pointer' : 'default' }}>
                <input type="checkbox" checked={contacts} disabled={!hunter.configured} onChange={(event) => setF({ contacts: event.target.checked })} style={{ marginTop: 3 }} />
                <span>
                  <b>Buscar decisores das qualificadas</b>
                  <div className="mt">Gasta crédito Hunter, só em empresas já qualificadas.</div>
                </span>
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label className="lb">
                  Teto de créditos
                  <input className="in" type="number" min={1} max={100} value={funnel.maxCredits} disabled={!contacts} onChange={(event) => setF({ maxCredits: toInt(event.target.value, 1, 100) })} />
                </label>
                <label className="lb">
                  Decisores/empresa
                  <input className="in" type="number" min={1} max={5} value={funnel.perCompany} disabled={!contacts} onChange={(event) => setF({ perCompany: toInt(event.target.value, 1, 5) })} />
                </label>
              </div>
            </div>
          </section>

          <section className="cd" data-tour="prospect-run">
            <div className="cdh">
              <h2 className="h">3 · Conferir e rodar</h2>
            </div>
            <div className="cdb" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <SummaryRow label="Empresas lidas">
                  <b className="mono">até {preview ? Math.min(preview.imported.length, form.limit) : form.limit}</b>
                </SummaryRow>
                <SummaryRow label="Créditos Hunter">
                  <b className="mono">{contacts ? `até ${cap} crédito${cap === 1 ? '' : 's'}` : 'nenhum'}</b>
                </SummaryRow>
                <SummaryRow label="Saldo depois">
                  <b className="mono">{contacts ? `${Math.max(0, credits - cap)} (no pior caso)` : credits}</b>
                </SummaryRow>
                <SummaryRow label="Custo da IA">
                  <span className="mt">centavos por empresa</span>
                </SummaryRow>
              </div>
              {warn && (
                <div className="bn rd">
                  <span>{warn}</span>
                </div>
              )}
              {preview && (
                <div className="bn gn">
                  <div>
                    <b>
                      Prévia: {preview.imported.length} nova{preview.imported.length === 1 ? '' : 's'}
                    </b>{' '}
                    de {found} encontrada{found === 1 ? '' : 's'}.
                    <div className="mt">
                      {preview.alreadyKnown.length} já estão na base e serão ignoradas
                      {preview.noContacts.length ? `; ${preview.noContacts.length} sem e-mail pessoal no Hunter ficam de fora` : ''}. Nada foi gasto.
                    </div>
                    {preview.imported.length > 0 && (
                      <div className="mt mono" style={{ marginTop: 4 }}>
                        {preview.imported.slice(0, 6).map((item) => item.domain).join(', ')}
                        {preview.imported.length > 6 ? ` e mais ${preview.imported.length - 6}` : ''}
                      </div>
                    )}
                  </div>
                </div>
              )}
              <button className={`bt${preview ? '' : ' p'}`} disabled={busy || !!warn || running} onClick={doPreview}>
                Prévia (grátis)
              </button>
              <button
                className="bt p"
                disabled={busy || !!warn || !preview || preview.imported.length === 0 || running}
                onClick={() => startJob(() => prospectApi.search(search(), { ...funnel, contacts }), 'Busca iniciada. Os resultados chegam em Para revisar e no histórico.')}
              >
                Rodar prospecção
              </button>
              <div className="mt">
                {running
                  ? 'Já há uma busca rodando.'
                  : warn
                    ? ''
                    : !preview
                      ? 'Rode a prévia primeiro. Ela mostra quantas empresas são novas, sem gastar nada.'
                      : preview.imported.length === 0
                        ? 'Nenhuma empresa nova nessa busca. Mude a região, o tamanho ou as palavras-chave.'
                        : `Gasta no máximo ${cap} crédito(s) Hunter, só em empresas qualificadas.`}
              </div>
            </div>
          </section>
        </div>
      </div>

      <section className="cd" data-tour="prospect-history">
        <div className="cdh">
          <h2 className="h">Últimas buscas</h2>
          <span className="sp" />
          <span className="mt">horário de Brasília; UTC no hover</span>
        </div>
        <div className="tbw" style={{ border: 0, borderRadius: 0 }}>
          <table className="tb">
            <thead>
              <tr>
                {['Quando', 'Busca', 'Lidas', 'Qualificadas', 'Para revisar', 'Descartadas', 'Créditos'].map((label) => (
                  <th key={label} scope="col">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.length === 0 && (
                <tr>
                  <td colSpan={7} className="mt">
                    Nenhuma busca ainda.
                  </td>
                </tr>
              )}
              {history.map((item) => (
                <RunRow key={item.id} run={item} live={running && item.id === job?.id} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="cd" data-tour="prospect-review">
        <div className="cdh">
          <h2 className="h">Para revisar</h2>
          <span className="cnt am">{review.length}</span>
          <span className="mt">Nada aqui foi decidido. Cada linha tem uma saída.</span>
        </div>
        {selected.size > 0 && (
          <div className="row" style={{ padding: '8px 14px', background: 'var(--acs)', borderBottom: '1px solid var(--ln)' }}>
            <b>
              {selected.size} selecionada{selected.size === 1 ? '' : 's'}
            </b>
            <button className="bt sm" disabled={busy || running || retryable.length === 0} onClick={() => retry(retryable)}>
              Tentar de novo (grátis)
            </button>
            <button className="bt sm" disabled={busy} onClick={() => (setReason(''), setOtherReason(''), setDiscard({ domains: [...selected], what: `${selected.size} empresas` }))}>
              Descartar
            </button>
            {retryable.length < selected.size && <span className="mt">{selected.size - retryable.length} não podem ser reprocessadas</span>}
            <span className="sp" />
            <button className="bt sm gh" onClick={() => setSelected(new Set())}>
              Limpar
            </button>
          </div>
        )}
        {groups.map((group) => (
          <div key={group.title}>
            <div className="row" style={{ padding: '10px 14px 6px', background: 'var(--s2)', borderBottom: '1px solid var(--ln)' }}>
              <b>{group.title}</b>
              <span className={`cnt ${group.color}`}>{group.items.length}</span>
              <span className="mt">{group.hint}</span>
            </div>
            {group.items.map((item) => {
              const text = REVIEW_TEXT[item.kind];
              const domain = item.company.domain;
              const detail = item.kind === 'unclear' ? item.note : (text.detail ?? (item.kind === 'failed' ? item.note : ''));
              return (
                <div key={domain} className="row" style={{ padding: '8px 14px', borderBottom: '1px solid var(--ln)', gap: 10, flexWrap: 'nowrap' }}>
                  <input type="checkbox" checked={selected.has(domain)} onChange={() => flip(domain)} aria-label={`Selecionar ${domain}`} />
                  <Link className="mono nm" to={`/empresas/${domain}`} style={{ width: 230, flex: 'none', fontWeight: 500 }}>
                    {domain}
                  </Link>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div>{text.reason}</div>
                    {detail && (
                      <div className="mt" style={{ maxWidth: 640 }}>
                        {detail}
                      </div>
                    )}
                  </div>
                  <Chip color={text.color}>{text.chip}</Chip>
                  <a className="bt sm" href={`https://${domain}/`} target="_blank" rel="noopener noreferrer">
                    Abrir site
                  </a>
                  {RETRYABLE.has(item.kind) ? (
                    <button className="bt sm" disabled={busy || running} onClick={() => retry([domain])}>
                      Tentar de novo
                    </button>
                  ) : (
                    <Link className={`bt sm${item.kind === 'unclear' ? ' p' : ''}`} to={`/empresas/${domain}`}>
                      {item.kind === 'unclear' ? 'Julgar na empresa' : 'Avaliar à mão'}
                    </Link>
                  )}
                  <button className="bt sm gh" onClick={() => (setReason(''), setOtherReason(''), setDiscard({ domains: [domain], what: domain }))}>
                    Descartar
                  </button>
                </div>
              );
            })}
          </div>
        ))}
        {review.length === 0 && (
          <div className="mt" style={{ padding: 20, textAlign: 'center' }}>
            Nada para revisar. Novas buscas aparecem aqui só se a IA não puder decidir.
          </div>
        )}
      </section>

      {discard && (
        <Dialog label="Descartar" onClose={() => setDiscard(null)}>
          <h2 className="h" style={{ fontSize: 15 }}>
            Descartar {discard.what}
          </h2>
          <div className="mt">O descarte fica no histórico com o motivo, e a empresa passa a Desqualificada. Ela não volta a aparecer em novas buscas.</div>
          <label className="lb">
            Motivo (obrigatório)
            <select className="in" value={reason} onChange={(event) => setReason(event.target.value)}>
              <option value="">Escolha…</option>
              {DISCARD_REASONS.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {reason === 'Outro' && (
            <label className="lb">
              Qual?
              <input className="in" value={otherReason} onChange={(event) => setOtherReason(event.target.value)} autoFocus />
            </label>
          )}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="bt" onClick={() => setDiscard(null)}>
              Cancelar
            </button>
            <button
              className="bt p"
              disabled={busy || !discardReason}
              onClick={async () => {
                const domains = discard.domains;
                const done = await run(
                  async () => {
                    for (const domain of domains) await companyApi.status(domain, 'disqualified', `Descoberta: ${discardReason}`);
                    return true;
                  },
                  { success: domains.length === 1 ? 'Descartada. Motivo gravado no histórico.' : `${domains.length} descartadas. Motivo gravado no histórico.`, reload: [status.reload] },
                );
                if (done) {
                  setDiscard(null);
                  setSelected(new Set());
                }
              }}
            >
              Descartar
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
};
