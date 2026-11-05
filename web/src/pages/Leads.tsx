import { useMemo, useState } from 'react';
import { type DiscoverLeadsReport, type LeadRow, type LeadsData, leadApi, useApi } from '../api';
import { JobPanel, useJob } from '../components/JobPanel';
import { Banner, Chip, Dialog, ErrorBox, Loading, StatusChip, useAction } from '../components/ui';
import { brDateTime, shortDate } from '../format';
import { Link } from '../router';

const VERDICT: Record<LeadRow['verdict'], { color: string; label: string; hint: string }> = {
  fit: { color: 'gn', label: 'Bom perfil', hint: 'A IA achou no site uma frase que confirma o que a empresa faz. Só estes entram na fila de WhatsApp.' },
  not_a_fit: { color: 'rd', label: 'Descartado', hint: 'A IA achou no site uma frase que mostra que não é o perfil.' },
  unclear: { color: 'am', label: 'Em dúvida', hint: 'A IA não achou uma citação verificável. Ninguém é contatado sem revisão.' },
  unreadable: { color: 'am', label: 'Site não lido', hint: 'O site não abriu desta vez. A IA tenta de novo na próxima rodada, sem custo.' },
  no_whatsapp: { color: 'gy', label: 'Sem WhatsApp', hint: 'Sem número de WhatsApp o lead não pode ser contatado por aqui, então a IA não gasta avaliação com ele.' },
  pending: { color: 'gy', label: 'Aguardando IA', hint: 'Ainda não foi avaliado. A IA só avalia quem já tem WhatsApp.' },
};

const SIGNAL_KIND = { activity: 'o que faz', need: 'sinal de necessidade', contradiction: 'contra o perfil' } as const;

const Stat = ({ label, value, hint }: { label: string; value: number | string; hint?: string }) => (
  <div className="cd" style={{ flex: '1 1 130px' }} title={hint}>
    <div className="cdb" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span className="mono" style={{ fontSize: 22 }}>
        {value}
      </span>
      <span className="mt">{label}</span>
    </div>
  </div>
);

const LeadDialog = ({ lead, onClose }: { lead: LeadRow; onClose: () => void }) => {
  const verdict = VERDICT[lead.verdict];
  return (
    <Dialog label={`Lead ${lead.name}`} onClose={onClose} width={720}>
      <h2 className="h" style={{ fontSize: 17 }}>
        {lead.name}
      </h2>
      <div className="mt">{[lead.address, [lead.city, lead.state].filter(Boolean).join(' - ')].filter(Boolean).join(' · ')}</div>
      <div className="row">
        <Chip color={verdict.color} title={verdict.hint}>
          {verdict.label}
        </Chip>
        <StatusChip status={lead.status} />
        {lead.rating !== undefined && (
          <span className="mt">
            Google: {lead.rating.toFixed(1)} ({lead.reviewCount ?? 0} avaliações)
          </span>
        )}
      </div>
      {lead.reason && (
        <div className="bn gy">
          <span>
            <b>IA{lead.model ? ` (${lead.model})` : ''}:</b> {lead.reason}
          </span>
        </div>
      )}
      <div className="fgrid" style={{ overflowWrap: 'anywhere' }}>
        <div>
          <div className="mt">Telefone do Google</div>
          <span className="mono">{lead.phone}</span> <span className="mt">{lead.phoneKind === 'landline' ? '(fixo)' : '(celular)'}</span>
        </div>
        <div>
          <div className="mt">WhatsApp para contato</div>
          {lead.whatsapp ? (
            <>
              <span className="mono">{lead.whatsapp}</span>
              <div className="mt">
                {lead.whatsappSource?.startsWith('http') ? (
                  <>
                    publicado em{' '}
                    <a href={lead.whatsappSource} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>
                      {lead.whatsappSource}
                    </a>
                  </>
                ) : (
                  lead.whatsappSource
                )}
              </div>
            </>
          ) : (
            <span className="mt">{lead.enrichedAt ? (lead.enrichmentNote ?? 'não achado') : 'o site ainda não foi lido'}</span>
          )}
        </div>
        <div>
          <div className="mt">Site</div>
          {lead.website ? (
            <a href={lead.website} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>
              {lead.website}
            </a>
          ) : (
            <span className="mt">sem site</span>
          )}
        </div>
        <div>
          <div className="mt">Origem</div>
          {lead.source}
        </div>
      </div>
      {lead.signals.length > 0 && (
        <section className="cd">
          <div className="cdh">
            <h2 className="h">Evidências da IA</h2>
            <span className="mt">cada citação é conferida no texto do site</span>
          </div>
          {lead.signals.map((signal, index) => (
            <div className="li" key={index} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
              <div className="row" style={{ gap: 8 }}>
                <Chip color={signal.verified ? 'gn' : 'am'} dot={false}>
                  {signal.verified ? 'verificada' : 'não verificada'}
                </Chip>
                <b>{SIGNAL_KIND[signal.kind]}</b>
                <span>{signal.claim}</span>
              </div>
              <div className="mt">“{signal.quote}”</div>
            </div>
          ))}
        </section>
      )}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        {lead.message && (
          <Link className="bt" to="/whatsapp">
            Ver mensagem na fila ({lead.message.status})
          </Link>
        )}
        <button className="bt" onClick={onClose}>
          Fechar
        </button>
      </div>
    </Dialog>
  );
};

const SearchDialog = ({ onClose, onDone }: { onClose: () => void; onDone: () => void }) => {
  const { run, busy } = useAction();
  const [form, setForm] = useState({ city: '', state: '', area: '', limit: 20 });
  const [report, setReport] = useState<DiscoverLeadsReport | null>(null);
  const input = (dryRun: boolean) => ({ city: form.city.trim(), state: form.state.trim().toUpperCase() || undefined, area: form.area.trim() || undefined, limit: form.limit, dryRun });
  const valid = form.city.trim().length > 0 && (form.state.trim() === '' || form.state.trim().length === 2);

  return (
    <Dialog label="Buscar leads em um lugar" onClose={onClose}>
      <h2 className="h" style={{ fontSize: 17 }}>
        Buscar leads em um lugar
      </h2>
      <div className="mt">Uma busca traz no máximo 60 lugares. Em cidade grande, use o bairro para chegar nos que a busca da cidade deixa de fora.</div>
      <div className="fgrid">
        <label className="lb">
          Cidade
          <input className="in" value={form.city} onChange={(event) => (setForm({ ...form, city: event.target.value }), setReport(null))} placeholder="Natal" />
        </label>
        <label className="lb">
          UF
          <input className="in mono" maxLength={2} value={form.state} onChange={(event) => (setForm({ ...form, state: event.target.value }), setReport(null))} placeholder="RN" />
        </label>
        <label className="lb">
          Bairro (opcional)
          <input className="in" value={form.area} onChange={(event) => (setForm({ ...form, area: event.target.value }), setReport(null))} placeholder="Ponta Negra" />
        </label>
        <label className="lb">
          Quantos
          <input className="in mono" type="number" min={1} max={60} value={form.limit} onChange={(event) => (setForm({ ...form, limit: Math.min(60, Math.max(1, Number(event.target.value) || 1)) }), setReport(null))} />
        </label>
      </div>
      {report && (
        <Banner color="bl">
          <b>{report.imported.length}</b> entrariam ou entraram. Já cadastrados: {report.alreadyKnown.length}. Sem telefone: {report.noPhone.length}. Telefone fora do padrão: {report.invalidPhone.length}.
        </Banner>
      )}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="bt" onClick={onClose}>
          Fechar
        </button>
        <button className="bt" disabled={busy || !valid} onClick={async () => setReport((await run(() => leadApi.discover(input(true)))) ?? null)}>
          Simular
        </button>
        <button
          className="bt p"
          disabled={busy || !valid}
          onClick={async () => {
            const result = await run(() => leadApi.discover(input(false)), { success: 'Busca feita' });
            if (result) {
              setReport(result);
              onDone();
            }
          }}
        >
          Buscar e importar
        </button>
      </div>
    </Dialog>
  );
};

export const LeadsPage = () => {
  const { data, error, reload } = useApi<LeadsData>('/api/leads');
  const { job, start, stop, running } = useJob(['leads.auto', 'leads.enrich', 'leads.qualify'], () => void reload());
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [verdict, setVerdict] = useState('');
  const [query, setQuery] = useState('');
  const [onlyWhatsapp, setOnlyWhatsapp] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.leads ?? []).filter(
      (lead) =>
        (!verdict || lead.verdict === verdict) &&
        (!onlyWhatsapp || lead.whatsapp) &&
        (!needle || lead.name.toLowerCase().includes(needle) || (lead.city ?? '').toLowerCase().includes(needle) || lead.phone.includes(needle) || (lead.whatsapp ?? '').includes(needle)),
    );
  }, [data, verdict, query, onlyWhatsapp]);

  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const { summary, discovery } = data;
  const lead = data.leads.find((item) => item.id === open);
  const quotaPct = Math.min(100, Math.round((discovery.requestsThisMonth / discovery.maxRequestsPerMonth) * 100));

  return (
    <>
      <div className="row">
        <div>
          <h1 className="t">Leads</h1>
          <div className="sub">Negócios achados no Google por telefone. A IA lê o site de cada um e só os de bom perfil entram na fila de WhatsApp.</div>
        </div>
        <span className="sp" />
        <button className="bt" disabled={running || !discovery.places} onClick={() => setSearching(true)}>
          Buscar em um lugar
        </button>
      </div>

      {!discovery.places && (
        <Banner color="am" icon="warn">
          <b>Google Places não configurado.</b> Defina <span className="mono">GOOGLE_PLACES_API_KEY</span> no <span className="mono">.env</span> e reinicie a API para buscar leads novos.
        </Banner>
      )}
      {!discovery.ai && (
        <Banner color="am" icon="warn">
          <b>IA de qualificação não configurada.</b> Sem <span className="mono">AWS_BEARER_TOKEN_BEDROCK</span> ninguém é avaliado, e portanto ninguém é contatado.
        </Banner>
      )}

      <div className="row" style={{ alignItems: 'stretch' }}>
        <Stat label="leads" value={summary.total} />
        <Stat label="bom perfil" value={summary.fit} hint={VERDICT.fit.hint} />
        <Stat label="em dúvida" value={summary.unclear} hint={VERDICT.unclear.hint} />
        <Stat label="descartados" value={summary.notFit} hint={VERDICT.not_a_fit.hint} />
        <Stat label="aguardando IA" value={summary.pending} hint={VERDICT.pending.hint} />
        <Stat label="com WhatsApp" value={summary.withWhatsapp} />
        <Stat label="já contatados" value={summary.contacted} />
      </div>

      <section className="cd">
        <div className="cdh">
          <h2 className="h">Rotina</h2>
          <span className="mt">Os passos também rodam sozinhos em "Rotina completa" na tela WhatsApp.</span>
        </div>
        <div className="cdb row" style={{ alignItems: 'center' }}>
          <button className="bt" disabled={running || !discovery.places} onClick={() => (setDismissed(null), start('leads.auto'))} title="Procura o próximo lugar da lista quando faltam candidatos">
            Buscar lugares novos
          </button>
          <button className="bt" disabled={running || summary.notRead === 0} onClick={() => (setDismissed(null), start('leads.enrich'))} title="Lê o site de cada lead e acha o WhatsApp que a empresa publica">
            Ler sites ({summary.notRead})
          </button>
          <button className="bt" disabled={running || !discovery.ai} onClick={() => (setDismissed(null), start('leads.qualify'))} title="A IA avalia os leads que já têm WhatsApp">
            Avaliar com a IA
          </button>
          <span className="sp" />
          <span className="mt">
            Candidatos esperando: <b>{discovery.candidates}</b> (busca automática abaixo de {discovery.minCandidates})
          </span>
        </div>
        <div className="cdb">
          <div className="row" style={{ gap: 6 }}>
            <span className="mt">Google neste mês</span>
            <span className="sp" />
            <b>
              {discovery.requestsThisMonth} de {discovery.maxRequestsPerMonth} requisições
            </b>
          </div>
          <div className="prog" style={{ maxWidth: 'none' }}>
            {Array.from({ length: 20 }, (_, position) => (
              <i key={position} className={position < Math.round(quotaPct / 5) ? 'd' : ''} />
            ))}
          </div>
          <div className="mt">Uma requisição traz até 20 lugares. A cota grátis do Google é de 1.000 por mês; a busca automática para no teto acima.</div>
        </div>
      </section>

      {job && dismissed !== job.id && <JobPanel job={job} onStop={stop} onClose={() => setDismissed(job.id)} />}

      <section className="cd">
        <div className="cdh">
          <h2 className="h">Perfil e lugares da busca automática</h2>
          <span className="mt">Edite em config/leads.json</span>
        </div>
        <div className="cdb" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <div className="mt">O que a IA procura (perfil)</div>
            {discovery.profile}
          </div>
          <div className="row" style={{ gap: 6 }}>
            {discovery.targets.map((target) => {
              const label = [target.area, target.city, target.state].filter(Boolean).join(', ');
              return (
                <Chip key={label} color={target.lastRan ? 'gn' : 'gy'} dot={false} title={target.lastRan ? `pesquisado em ${brDateTime(target.lastRan, true)}; repete depois de ${discovery.cooldownDays} dias` : 'ainda não pesquisado'}>
                  {label}
                  {target.lastRan ? ` · ${shortDate(target.lastRan)}` : ''}
                </Chip>
              );
            })}
          </div>
        </div>
      </section>

      <div className="row">
        <input className="in" style={{ flex: '1 1 260px' }} placeholder="Buscar por nome, cidade ou telefone…" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select className="in" value={verdict} onChange={(event) => setVerdict(event.target.value)} aria-label="Filtrar por veredito da IA">
          <option value="">Todos os vereditos</option>
          {Object.entries(VERDICT).map(([key, value]) => (
            <option key={key} value={key}>
              {value.label}
            </option>
          ))}
        </select>
        <label className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={onlyWhatsapp} onChange={(event) => setOnlyWhatsapp(event.target.checked)} /> só com WhatsApp
        </label>
        <span className="mt">{rows.length} de {data.leads.length}</span>
      </div>

      <div className="tbw">
        <table className="tb">
          <thead>
            <tr>
              {['Lead', 'WhatsApp', 'Veredito da IA', 'Situação'].map((label) => (
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
                  {data.leads.length === 0 ? 'Nenhum lead ainda. Use "Buscar em um lugar" ou rode a rotina.' : 'Nenhum lead com esse filtro.'}
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} onClick={() => setOpen(row.id)} style={{ cursor: 'pointer' }}>
                <td>
                  <div className="nm">{row.name}</div>
                  <div className="mt">{[row.city, row.state].filter(Boolean).join(' - ')}{row.rating !== undefined ? ` · ★ ${row.rating.toFixed(1)}` : ''}</div>
                </td>
                <td>
                  {row.whatsapp ? (
                    <>
                      <span className="mono">{row.whatsapp}</span>
                      <div className="mt">{row.whatsappSource?.startsWith('http') ? 'do site da empresa' : 'celular do Google, sem confirmação'}</div>
                    </>
                  ) : (
                    <span className="mt">{row.enrichedAt ? (row.enrichmentNote ?? 'não achado') : 'site não lido'}</span>
                  )}
                </td>
                <td>
                  <Chip color={VERDICT[row.verdict].color} title={VERDICT[row.verdict].hint}>
                    {VERDICT[row.verdict].label}
                  </Chip>
                  {row.reason && row.verdict !== 'fit' && <div className="mt" style={{ maxWidth: 360 }}>{row.reason}</div>}
                </td>
                <td>
                  {row.message ? <StatusChip status={row.message.status} title="mensagem na fila" /> : <StatusChip status={row.status} />}
                  {row.message && <div className="mt">mensagem na fila</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {lead && <LeadDialog lead={lead} onClose={() => setOpen(null)} />}
      {searching && <SearchDialog onClose={() => setSearching(false)} onDone={() => void reload()} />}
    </>
  );
};
