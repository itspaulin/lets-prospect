import { useEffect, useState } from 'react';
import { api, type Deliverability, type Settings, useApi } from '../api';
import { Banner, Chip, Dialog, ErrorBox, Loading, useAction, useMeta, useToast } from '../components/ui';

const useChecklist = (key: string) => {
  const [done, setDone] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, boolean>;
    } catch {
      return {};
    }
  });
  const toggle = (id: string) =>
    setDone((current) => {
      const next = { ...current, [id]: !current[id] };
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* storage blocked: keeps only for this session */
      }
      return next;
    });
  return { done, toggle };
};

const Check = ({ ok, label, detail, onToggle }: { ok: boolean; label: string; detail?: string; onToggle?: () => void }) => (
  <div className="li">
    {onToggle ? <input type="checkbox" checked={ok} onChange={onToggle} /> : <Chip color={ok ? 'gn' : 'rd'}>{ok ? 'ok' : 'falta'}</Chip>}
    <span style={{ flex: '1 1 240px' }}>{label}</span>
    {detail && (
      <span className="mono mt" style={{ flex: '1 1 300px', wordBreak: 'break-all' }}>
        {detail}
      </span>
    )}
  </div>
);

const SendingRules = ({ settings, reload }: { settings: Settings; reload: () => Promise<void> }) => {
  const { run, busy } = useAction();
  const initial = () => ({
    dailyLimit: String(settings.sending.dailyLimit),
    minIntervalSeconds: String(settings.sending.minIntervalSeconds),
    maxFollowUps: String(settings.sending.followUp.maxFollowUps),
    intervals: settings.sending.followUp.intervalBusinessDays.join(', '),
    footer: settings.sending.footer,
  });
  const [form, setForm] = useState(initial);
  useEffect(() => setForm(initial()), [settings.sending.version]);
  const changed = JSON.stringify(form) !== JSON.stringify(initial());
  const save = () =>
    run(
      () =>
        api.put('/api/settings/sending', {
          ...settings.sending,
          dailyLimit: Number(form.dailyLimit),
          minIntervalSeconds: Number(form.minIntervalSeconds),
          followUp: {
            maxFollowUps: Number(form.maxFollowUps),
            intervalBusinessDays: form.intervals
              .split(/[,;\s]+/)
              .filter(Boolean)
              .map(Number),
          },
          footer: form.footer,
        }),
      { success: 'Regras de envio salvas em config/sending.json e aplicadas.', reload: [reload] },
    );
  const field = (key: keyof ReturnType<typeof initial>) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [key]: event.target.value });

  return (
    <section className="cd" data-tour="settings-rules">
      <div className="cdh">
        <h2 className="h">Regras de envio</h2>
        <span className="mt">config/sending.json · versão {settings.sending.version}</span>
      </div>
      <div className="cdb" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="fg">
          <label className="lb">
            Limite diário (UTC)
            <input className="in" inputMode="numeric" value={form.dailyLimit} onChange={field('dailyLimit')} />
          </label>
          <label className="lb">
            Intervalo mínimo entre envios (s)
            <input className="in" inputMode="numeric" value={form.minIntervalSeconds} onChange={field('minIntervalSeconds')} />
          </label>
          <label className="lb">
            Máximo de follow-ups (0 a 3)
            <input className="in" inputMode="numeric" value={form.maxFollowUps} onChange={field('maxFollowUps')} />
          </label>
          <label className="lb">
            Dias úteis após o 1º e-mail, um por follow-up (ex.: 3, 5, 7)
            <input className="in" value={form.intervals} onChange={field('intervals')} placeholder="3, 5, 7" />
          </label>
        </div>
        <label className="lb">
          Rodapé (placeholders: {'{{sender.name}}'}, {'{{sender.postalAddress}}'})
          <textarea className="in mono" rows={4} value={form.footer} onChange={field('footer')} />
        </label>
        <div>
          <div className="mt" style={{ marginBottom: 4 }}>
            Rodapé com os dados atuais
          </div>
          <div className="mail" style={{ whiteSpace: 'pre-wrap' }}>
            {settings.footerPreview}
          </div>
        </div>
        <Banner color="am" icon="warn">
          Mantenha no rodapé o endereço postal e como parar de receber (CAN-SPAM). Limites altos com domínio novo tendem a cair em spam.
        </Banner>
        <div className="row">
          <span className="sp" />
          <button className="bt" disabled={!changed} onClick={() => setForm(initial())}>
            Descartar
          </button>
          <button className="bt p" disabled={busy || !changed} onClick={save}>
            Salvar regras
          </button>
        </div>
      </div>
    </section>
  );
};

const StackEditor = ({ settings, reload }: { settings: Settings; reload: () => Promise<void> }) => {
  const { run, busy } = useAction();
  const criterion = settings.scoring.criteria.find((item) => item.type === 'technology_overlap');
  const saved = criterion?.type === 'technology_overlap' ? criterion.technologies : [];
  const savedMin = criterion?.type === 'technology_overlap' ? criterion.minKnown : 3;
  const [stack, setStack] = useState(saved);
  const [minKnown, setMinKnown] = useState(String(savedMin));
  const [adding, setAdding] = useState('');
  useEffect(() => (setStack(saved), setMinKnown(String(savedMin))), [settings.scoring.version]);
  if (!criterion) return null;
  const changed = JSON.stringify(stack) !== JSON.stringify(saved) || Number(minKnown) !== savedMin;
  const add = () => {
    const names = adding.split(',').map((item) => item.trim()).filter(Boolean);
    const known = new Set(stack.map((item) => item.toLowerCase()));
    setStack([...stack, ...names.filter((name) => !known.has(name.toLowerCase()))]);
    setAdding('');
  };
  const save = () =>
    run(
      () =>
        api.put('/api/settings/scoring', {
          ...settings.scoring,
          criteria: settings.scoring.criteria.map((item) => (item.id === criterion.id ? { ...item, technologies: stack, minKnown: Number(minKnown) } : item)),
        }),
      { success: 'Stack salva em config/scoring.json. Reavalie as empresas para aplicar.', reload: [reload] },
    );

  return (
    <section className="cd" data-tour="settings-stack">
      <div className="cdh">
        <h2 className="h">Minha stack</h2>
        <span className="mt">Quanto maior a parte da stack da empresa que está aqui, maior a nota de stack ({criterion.weight} pontos)</span>
      </div>
      <div className="cdb" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="row" style={{ gap: 6 }}>
          {stack.map((tech) => (
            <span key={tech} className="tg mine" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {tech}
              <button className="lnk" aria-label={`Remover ${tech}`} title="Remover" onClick={() => setStack(stack.filter((item) => item !== tech))} style={{ border: 0, background: 'none', cursor: 'pointer', padding: 0 }}>
                ×
              </button>
            </span>
          ))}
          {stack.length === 0 && <span className="mt">Vazia: a nota de stack fica sempre zerada.</span>}
        </div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label className="lb" style={{ flex: '1 1 280px' }}>
            Adicionar (separe por vírgula)
            <input className="in" value={adding} placeholder="Ex.: Vue.js, Kotlin" onChange={(event) => setAdding(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && adding.trim() && add()} />
          </label>
          <button className="bt" disabled={!adding.trim()} onClick={add}>
            Adicionar
          </button>
          <label className="lb" style={{ width: 200 }}>
            Mínimo de tecnologias conhecidas
            <input className="in" inputMode="numeric" value={minKnown} onChange={(event) => setMinKnown(event.target.value)} />
          </label>
        </div>
        <div className="mt">
          Exemplo: empresa com 10 tecnologias, 4 delas aqui, recebe 40% dos pontos de stack. Abaixo do mínimo de tecnologias conhecidas, a parte vale como hipótese (metade), para um
          site que cita só “React” não ganhar nota cheia. Grafias diferentes contam como a mesma (Node, NodeJS e Node.js).
        </div>
        <div className="row">
          <span className="sp" />
          <button className="bt" disabled={!changed} onClick={() => (setStack(saved), setMinKnown(String(savedMin)))}>
            Descartar
          </button>
          <button className="bt p" disabled={busy || !changed || stack.length === 0 || !(Number(minKnown) >= 1)} onClick={save}>
            Salvar stack
          </button>
        </div>
      </div>
    </section>
  );
};

const ScoringEditor = ({ settings, reload }: { settings: Settings; reload: () => Promise<void> }) => {
  const { run, busy } = useAction();
  const initial = () => ({
    weights: Object.fromEntries(settings.scoring.criteria.map((criterion) => [criterion.id, String(criterion.weight)])),
    high: String(Math.round(settings.scoring.priorityThresholds.high * 100)),
    medium: String(Math.round(settings.scoring.priorityThresholds.medium * 100)),
    hypothesis: String(Math.round(settings.scoring.hypothesisFactor * 100)),
    coverage: String(Math.round(settings.scoring.minCoverageForPriority * 100)),
  });
  const [form, setForm] = useState(initial);
  useEffect(() => setForm(initial()), [settings.scoring.version]);
  const changed = JSON.stringify(form) !== JSON.stringify(initial());
  const total = Object.values(form.weights).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const save = () =>
    run(
      () =>
        api.put('/api/settings/scoring', {
          ...settings.scoring,
          hypothesisFactor: Number(form.hypothesis) / 100,
          minCoverageForPriority: Number(form.coverage) / 100,
          priorityThresholds: { high: Number(form.high) / 100, medium: Number(form.medium) / 100 },
          criteria: settings.scoring.criteria.map((criterion) => ({ ...criterion, weight: Number(form.weights[criterion.id]) })),
        }),
      { success: 'Pesos salvos em config/scoring.json. Reavalie as empresas para aplicar.', reload: [reload] },
    );

  return (
    <section className="cd" data-tour="settings-scoring">
      <div className="cdh">
        <h2 className="h">Qualificação</h2>
        <span className="mt">config/scoring.json · versão {settings.scoring.version}</span>
      </div>
      <div className="tbw" style={{ border: 0, borderRadius: 0 }}>
        <table className="tb">
          <thead>
            <tr>
              <th scope="col">Critério</th>
              <th scope="col">Tipo</th>
              <th scope="col">Peso</th>
            </tr>
          </thead>
          <tbody>
            {settings.scoring.criteria.map((criterion) => (
              <tr key={criterion.id}>
                <td>
                  {criterion.label}
                  {settings.scoring.requiredForQualified.includes(criterion.id) && (
                    <Chip color="bl" dot={false}>
                      obrigatório para qualified
                    </Chip>
                  )}
                </td>
                <td className="mono mt">{criterion.type}</td>
                <td>
                  <input
                    className="in"
                    style={{ width: 80 }}
                    inputMode="numeric"
                    value={form.weights[criterion.id] ?? ''}
                    onChange={(event) => setForm({ ...form, weights: { ...form.weights, [criterion.id]: event.target.value } })}
                  />
                </td>
              </tr>
            ))}
            <tr>
              <td colSpan={2}>
                <b>Total</b> <span className="mt">(a pontuação é relativa ao total; não precisa somar 100)</span>
              </td>
              <td className="mono">{total}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="cdb fg">
        <label className="lb">
          Prioridade alta a partir de (%)
          <input className="in" inputMode="numeric" value={form.high} onChange={(event) => setForm({ ...form, high: event.target.value })} />
        </label>
        <label className="lb">
          Prioridade média a partir de (%)
          <input className="in" inputMode="numeric" value={form.medium} onChange={(event) => setForm({ ...form, medium: event.target.value })} />
        </label>
        <label className="lb">
          Cobertura mínima para sugerir (%)
          <input className="in" inputMode="numeric" value={form.coverage} onChange={(event) => setForm({ ...form, coverage: event.target.value })} />
        </label>
        <label className="lb">
          Hipótese vale (%)
          <input className="in" inputMode="numeric" value={form.hypothesis} onChange={(event) => setForm({ ...form, hypothesis: event.target.value })} />
        </label>
      </div>
      <div className="cdb row" style={{ paddingTop: 0 }}>
        <span className="mt" style={{ flex: 1 }}>
          Salvar cria uma nova versão. Avaliações antigas continuam com a versão anterior até você reavaliar cada empresa.
        </span>
        <button className="bt" disabled={!changed} onClick={() => setForm(initial())}>
          Descartar
        </button>
        <button className="bt p" disabled={busy || !changed} onClick={save}>
          Salvar pesos
        </button>
      </div>
    </section>
  );
};

export const SettingsPage = () => {
  const meta = useMeta();
  const toast = useToast();
  const { data, error, reload } = useApi<Settings>('/api/settings');
  const dns = useApi<Deliverability>('/api/settings/deliverability');
  const manual = useChecklist('settings.deliverability');
  const firstCampaign = useChecklist('settings.firstCampaign');
  const [testing, setTesting] = useState(false);
  const [typed, setTyped] = useState('');
  const [sendingTest, setSendingTest] = useState(false);

  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const reloadAll = async () => {
    await Promise.all([reload(), meta.reload()]);
  };
  const real = data.delivers;

  const sendTest = async () => {
    setSendingTest(true);
    try {
      const result = await api.post<{ status: string; error?: string; to: string }>('/api/settings/test-email', { confirm: real ? typed : undefined });
      toast(result.status === 'sent' ? `Teste ${real ? 'enviado' : 'gravado na caixa de saída'} para ${result.to}. Confira os cabeçalhos.` : `Teste ${result.status}: ${result.error}`, result.status === 'sent' ? 'gn' : 'rd');
      setTesting(false);
    } catch (failure) {
      toast((failure as Error).message, 'rd');
    } finally {
      setSendingTest(false);
    }
  };

  const MANUAL = [
    ['domain', 'Domínio próprio registrado (Cloudflare Registrar)'],
    ['mailbox', 'Caixa criada no Zoho Mail Lite (o plano grátis não tem SMTP)'],
    ['app-password', 'Senha de app gerada para o SMTP (nunca a senha principal)'],
    ['smtp-test', 'Teste SMTP recebido no Gmail com SPF, DKIM e DMARC em pass'],
    ['warmup', 'Aquecimento: alguns dias de uso normal da caixa antes da 1ª campanha'],
  ];
  const FIRST = [
    ['dns', 'Seções acima concluídas, com SPF, DKIM e DMARC passando'],
    ['markets', 'Só EUA e Reino Unido nesta fase'],
    ['uk-companies', 'No Reino Unido, só empresas (Ltd, LLP); sole traders e partnerships exigem consentimento'],
    ['facts', 'Toda empresa tem fato verificado e todo e-mail tem fonte pública registrada'],
    ['template', 'Template revisado em inglês, sem prometer o que não foi confirmado nem supor vaga aberta'],
    ['personal', 'Mensagens genéricas revistas uma a uma: mande só as que fazem sentido'],
    ['batch', 'Lote pequeno na primeira semana (5 a 10 empresas), abaixo do limite diário'],
    ['dry-run', 'Simulação de envio conferida'],
  ];

  return (
    <>
      <div>
        <h1 className="t">Configurações</h1>
        <div className="sub">Remetente e SMTP vêm do .env (não editáveis aqui, para a senha nunca passar pelo navegador). Regras e pesos são editáveis.</div>
      </div>

      <div className="grid2" data-tour="settings-sender">
        <section className="cd" style={{ flex: '1 1 380px' }}>
          <div className="cdh">
            <h2 className="h">Remetente</h2>
            <span className="mt">.env</span>
          </div>
          <dl className="kv cdb" style={{ margin: 0 }}>
            <dt>SENDER_NAME</dt>
            <dd>{data.sender.name || <span className="ch rd nd">vazio</span>}</dd>
            <dt>SENDER_EMAIL</dt>
            <dd className="mono">{data.sender.email || <span className="ch rd nd">vazio</span>}</dd>
            <dt>Endereço postal</dt>
            <dd>{data.sender.postalAddress || <span className="ch rd nd">vazio (exigido pelo CAN-SPAM)</span>}</dd>
          </dl>
        </section>
        <section className="cd" style={{ flex: '1 1 380px' }}>
          <div className="cdh">
            <h2 className="h">Transporte</h2>
            <Chip color={data.transport === 'smtp' ? 'am' : 'bl'} dot={false}>
              {data.transport === 'smtp' ? 'SMTP real' : 'simulação (outbox)'}
            </Chip>
          </div>
          <dl className="kv cdb" style={{ margin: 0 }}>
            {data.transport === 'smtp' ? (
              <>
                <dt>Host</dt>
                <dd className="mono">
                  {data.smtp.host}:{data.smtp.port} {data.smtp.secure ? '(TLS)' : ''}
                </dd>
                <dt>Usuário</dt>
                <dd className="mono">{data.smtp.user}</dd>
                <dt>Senha de app</dt>
                <dd>{data.smtp.passwordSet ? '•••••••• definida' : <span className="ch rd nd">ausente</span>}</dd>
              </>
            ) : (
              <>
                <dt>Caixa de saída</dt>
                <dd className="mono">{data.paths.outbox}</dd>
                <dt>Para envio real</dt>
                <dd className="mt">
                  No .env: <span className="mono">EMAIL_TRANSPORT=smtp</span>, <span className="mono">SMTP_HOST=smtp.zoho.com</span>, <span className="mono">SMTP_PORT=465</span>,{' '}
                  <span className="mono">SMTP_USER</span> e <span className="mono">SMTP_PASSWORD</span> (senha de app). Reinicie o app.
                </dd>
              </>
            )}
          </dl>
          <div className="cdb row" style={{ paddingTop: 0 }}>
            <span className="mt" style={{ flex: 1 }}>
              Envia uma mensagem para o próprio remetente.
            </span>
            <button className="bt" onClick={() => (setTyped(''), setTesting(true))}>
              Enviar teste para mim
            </button>
          </div>
        </section>
      </div>

      <section className="cd" data-tour="settings-dns">
        <div className="cdh">
          <h2 className="h">Entregabilidade</h2>
          <span className="mt">DNS público do domínio do remetente{dns.data?.domain ? `: ${dns.data.domain}` : ''}</span>
          <span className="sp" />
          <button className="bt sm" onClick={() => dns.reload()}>
            Verificar de novo
          </button>
        </div>
        {dns.loading && !dns.data && <div className="cdb mt">Consultando DNS…</div>}
        {dns.data?.note && (
          <div className="cdb">
            <Banner color="am" icon="warn">
              {dns.data.note}
            </Banner>
          </div>
        )}
        {dns.data?.checks.map((check) => (
          <Check key={check.id} ok={check.ok} label={check.label} detail={check.detail} />
        ))}
        <div className="cdh" style={{ borderTop: '1px solid var(--ln)' }}>
          <h2 className="h">Passos manuais</h2>
          <span className="mt">Marcados só neste navegador</span>
        </div>
        {MANUAL.map(([id, label]) => (
          <Check key={id} ok={!!manual.done[id!]} label={label!} onToggle={() => manual.toggle(id!)} />
        ))}
        <div className="cdb mt">DNS presente não garante entrega: a prova é o teste SMTP chegando na caixa de entrada com SPF, DKIM e DMARC em pass nos cabeçalhos.</div>
      </section>

      <SendingRules settings={data} reload={reloadAll} />
      <StackEditor settings={data} reload={reloadAll} />
      <ScoringEditor settings={data} reload={reloadAll} />

      <section className="cd" data-tour="settings-checklist">
        <div className="cdh">
          <h2 className="h">Checklist da primeira campanha real</h2>
          <span className="mt">
            {FIRST.filter(([id]) => firstCampaign.done[id!]).length}/{FIRST.length}
          </span>
        </div>
        {FIRST.map(([id, label]) => (
          <Check key={id} ok={!!firstCampaign.done[id!]} label={label!} onToggle={() => firstCampaign.toggle(id!)} />
        ))}
      </section>

      <section className="cd">
        <div className="cdh">
          <h2 className="h">Dados</h2>
        </div>
        <dl className="kv cdb" style={{ margin: 0 }}>
          <dt>Banco</dt>
          <dd className="mono">{data.paths.database}</dd>
          <dt>Qualificação</dt>
          <dd className="mono">{data.paths.scoring}</dd>
          <dt>Envio</dt>
          <dd className="mono">{data.paths.sending}</dd>
          <dt>Backup</dt>
          <dd className="mt">Pare o app (Ctrl+C no terminal) e copie o arquivo do banco. data/ e .env ficam fora do git.</dd>
        </dl>
      </section>

      {testing && (
        <Dialog label="Enviar teste" onClose={() => setTesting(false)}>
          <h2 className="h" style={{ fontSize: 17 }}>
            Enviar teste para {data.sender.email || '(SENDER_EMAIL vazio)'}
          </h2>
          {real ? (
            <>
              <Banner color="rd" icon="warn">
                Envio real via SMTP para a sua própria caixa.
              </Banner>
              <label className="lb">
                Digite ENVIAR para confirmar
                <input className="in mono" value={typed} onChange={(event) => setTyped(event.target.value)} autoFocus />
              </label>
            </>
          ) : (
            <div className="mt">Modo simulação: o teste é gravado como .eml na caixa de saída local.</div>
          )}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="bt" onClick={() => setTesting(false)}>
              Cancelar
            </button>
            <button className="bt p" disabled={sendingTest || (real && typed !== 'ENVIAR')} onClick={sendTest}>
              Enviar teste
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
};
