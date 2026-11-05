import { useMemo, useState } from 'react';
import { type CompanyRow, type CompanyStatus, useApi } from '../api';
import { StatusDialog } from '../components/StatusDialog';
import { Banner, ErrorBox, Flag, KANBAN_ORDER, Loading, PRIORITY_LABEL, ScoreInline, STATUS_COLOR, StatusChip, statusLabel, TechTags, useMeta } from '../components/ui';
import { brDateTime, brToday, relativeDay, utcLabel } from '../format';
import { Link, navigate, useLocation } from '../router';

type Filters = {
  country: string;
  tech: string;
  priority: string;
  minEmployees: string;
  maxEmployees: string;
  hasContacts: string;
  dueBy: string;
  inactiveSince: string;
  activeSince: string;
  disqualifiedReason: string;
};
type Saved = { name: string; filters: Filters; statuses: CompanyStatus[] };

const EMPTY: Filters = { country: '', tech: '', priority: '', minEmployees: '', maxEmployees: '', hasContacts: '', dueBy: '', inactiveSince: '', activeSince: '', disqualifiedReason: '' };

const PRESETS: Saved[] = [
  { name: 'Todas', filters: EMPTY, statuses: [] },
  { name: 'Qualificadas com contato', filters: { ...EMPTY, hasContacts: 'yes' }, statuses: ['qualified'] },
  { name: 'Próxima ação até hoje', filters: { ...EMPTY, dueBy: brToday() }, statuses: [] },
  { name: 'Em conversa', filters: EMPTY, statuses: ['replied', 'interested', 'opportunity'] },
];

const loadSaved = (): Saved[] => {
  try {
    return JSON.parse(localStorage.getItem('companies.savedFilters') ?? '[]') as Saved[];
  } catch {
    return [];
  }
};

// qualified -> contacted is allowed by the rules but only happens on the first confirmed send.
const manualTargets = (meta: { transitions: Record<string, readonly string[]> }, from: CompanyStatus): CompanyStatus[] =>
  (meta.transitions[from] ?? []).filter((to) => !(from === 'qualified' && to === 'contacted')) as CompanyStatus[];

export const CompaniesPage = () => {
  const meta = useMeta().data!;
  const { query } = useLocation();
  const view = query.get('view') === 'kanban' ? 'kanban' : 'lista';
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [statuses, setStatuses] = useState<CompanyStatus[]>([]);
  const [saved, setSaved] = useState<Saved[]>(loadSaved);
  const [pick, setPick] = useState<CompanyRow | null>(null);
  const [overColumn, setOverColumn] = useState<CompanyStatus | null>(null);
  const [dialog, setDialog] = useState<{ company: CompanyRow; to: CompanyStatus } | null>(null);

  const url = useMemo(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    return `/api/companies?${params.toString()}`;
  }, [filters]);
  const companies = useApi<CompanyRow[]>(url);
  const duplicates = useApi<unknown[]>('/api/companies/duplicates');

  const all = companies.data ?? [];
  // Descartadas somem da lista por padrão (o histórico fica); escolher o status "Desqualificada" as mostra de volta.
  const rows = statuses.length ? all.filter((company) => statuses.includes(company.status)) : all.filter((company) => company.status !== 'disqualified');
  const hiddenCount = all.length - rows.length;
  const counts = Object.fromEntries(KANBAN_ORDER.map((status) => [status, all.filter((company) => company.status === status).length]));
  const today = brToday();

  const set = (key: keyof Filters) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setFilters((current) => ({ ...current, [key]: event.target.value }));
  const toggleStatus = (status: CompanyStatus) => setStatuses((current) => (current.includes(status) ? current.filter((item) => item !== status) : [...current, status]));
  const apply = (preset: Saved) => {
    setFilters(preset.filters);
    setStatuses(preset.statuses);
  };
  const isApplied = (preset: Saved) => JSON.stringify(preset.filters) === JSON.stringify(filters) && JSON.stringify([...preset.statuses].sort()) === JSON.stringify([...statuses].sort());
  const [naming, setNaming] = useState<string | null>(null);
  const saveCurrent = () => {
    const name = naming?.trim();
    setNaming(null);
    if (!name) return;
    const next = [...saved.filter((item) => item.name !== name), { name, filters, statuses }];
    setSaved(next);
    try {
      localStorage.setItem('companies.savedFilters', JSON.stringify(next));
    } catch {
      /* storage blocked: keeps only for this session */
    }
  };
  const removeSaved = (name: string) => {
    const next = saved.filter((item) => item.name !== name);
    setSaved(next);
    try {
      localStorage.setItem('companies.savedFilters', JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const targets = pick ? manualTargets(meta, pick.status) : [];
  const drop = (company: CompanyRow, to: CompanyStatus) => {
    setPick(null);
    setOverColumn(null);
    if (company.status === to || !manualTargets(meta, company.status).includes(to)) return;
    setDialog({ company, to });
  };

  const technologies = [...new Set([...meta.stack, ...all.flatMap((company) => company.technologies)])].sort((a, b) => a.localeCompare(b));
  const countries = [...new Set(['US', 'GB', 'CA', 'IE', 'AU', ...all.map((company) => company.country)])];

  return (
    <>
      <div className="row">
        <div>
          <h1 className="t">Empresas</h1>
          <div className="sub">
            {statuses.length ? `${rows.length} de ${all.length} empresas (filtrado por status)` : `${rows.length} empresas`} · {counts.qualified ?? 0} qualificadas
            {!statuses.length && hiddenCount > 0 && ` · ${hiddenCount} descartada${hiddenCount > 1 ? 's' : ''} oculta${hiddenCount > 1 ? 's' : ''}`}
          </div>
        </div>
        <div className="sp" />
        <div className="row" style={{ gap: 4 }} role="group" aria-label="Modo de visualização" data-tour="companies-views">
          <button className={`bt sm${view === 'lista' ? ' on' : ''}`} onClick={() => navigate('/empresas', { replace: true })}>
            Lista
          </button>
          <button className={`bt sm${view === 'kanban' ? ' on' : ''}`} onClick={() => navigate('/empresas?view=kanban', { replace: true })}>
            Kanban por status
          </button>
        </div>
        <span className="row" style={{ gap: 12 }} data-tour="companies-actions">
        <Link className="bt" to="/empresas/duplicadas">
          Possíveis duplicadas {!!duplicates.data?.length && <span className="cnt am">{duplicates.data.length}</span>}
        </Link>
        <Link className="bt" to="/empresas/nova?tab=csv">
          Importar CSV
        </Link>
        <Link className="bt p" to="/empresas/nova">
          Nova empresa
        </Link>
        </span>
      </div>

      <div className="row" style={{ gap: 6 }} aria-label="Filtros salvos" data-tour="companies-saved">
        <span className="mt">Filtros salvos</span>
        {PRESETS.map((preset) => (
          <button key={preset.name} className={`bt sm${isApplied(preset) ? ' on' : ''}`} onClick={() => apply(preset)}>
            {preset.name}
          </button>
        ))}
        {saved.map((preset) => (
          <span key={preset.name} className="row" style={{ gap: 0 }}>
            <button className={`bt sm${isApplied(preset) ? ' on' : ''}`} onClick={() => apply(preset)}>
              {preset.name}
            </button>
            <button className="bt sm gh" title="Remover filtro salvo" onClick={() => removeSaved(preset.name)}>
              ×
            </button>
          </span>
        ))}
        {naming === null ? (
          <button className="bt sm gh" onClick={() => setNaming('')}>
            Salvar filtro atual
          </button>
        ) : (
          <span className="row" style={{ gap: 4 }}>
            <input
              className="in"
              autoFocus
              placeholder="Nome do filtro"
              value={naming}
              onChange={(event) => setNaming(event.target.value)}
              onKeyDown={(event) => (event.key === 'Enter' ? saveCurrent() : event.key === 'Escape' && setNaming(null))}
              style={{ height: 26 }}
            />
            <button className="bt sm p" onClick={saveCurrent}>
              Salvar
            </button>
          </span>
        )}
      </div>

      <section className="cd" aria-label="Filtros">
        <div className="cdb" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="row" style={{ gap: 6 }} data-tour="companies-status">
            <span className="mt" style={{ width: 56 }}>
              Status
            </span>
            {KANBAN_ORDER.map((status) => {
              const on = statuses.includes(status);
              return (
                <button
                  key={status}
                  className={`ch ${STATUS_COLOR[status]} nd`}
                  style={{ border: `1px solid ${on ? 'currentColor' : 'transparent'}`, cursor: 'pointer', opacity: statuses.length && !on ? 0.55 : 1 }}
                  onClick={() => toggleStatus(status)}
                  aria-pressed={on}
                  title={status}
                >
                  {statusLabel(status)} · {counts[status]}
                </button>
              );
            })}
            <button className="bt sm gh" onClick={() => setStatuses([])}>
              Limpar
            </button>
          </div>
          <div className="fgrid" data-tour="companies-filters">
            <label className="lb">
              País
              <select className="in" value={filters.country} onChange={set('country')}>
                <option value="">Todos</option>
                {countries.map((country) => (
                  <option key={country}>{country}</option>
                ))}
              </select>
            </label>
            <label className="lb">
              Tecnologia
              <select className="in" value={filters.tech} onChange={set('tech')}>
                <option value="">Todas</option>
                {technologies.map((tech) => (
                  <option key={tech}>{tech}</option>
                ))}
              </select>
            </label>
            <label className="lb">
              Prioridade
              <select className="in" value={filters.priority} onChange={set('priority')}>
                <option value="">Todas</option>
                <option value="high">Alta</option>
                <option value="medium">Média</option>
                <option value="low">Baixa</option>
              </select>
            </label>
            <label className="lb">
              Funcionários
              <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                <input className="in" style={{ width: '100%' }} placeholder="mín." inputMode="numeric" value={filters.minEmployees} onChange={set('minEmployees')} />
                <input className="in" style={{ width: '100%' }} placeholder="máx." inputMode="numeric" value={filters.maxEmployees} onChange={set('maxEmployees')} />
              </span>
            </label>
            <label className="lb">
              Tem contatos
              <select className="in" value={filters.hasContacts} onChange={set('hasContacts')}>
                <option value="">Indiferente</option>
                <option value="yes">Sim</option>
                <option value="no">Não</option>
              </select>
            </label>
            <label className="lb">
              Próxima ação até
              <input className="in" type="date" value={filters.dueBy} onChange={set('dueBy')} />
            </label>
            <label className="lb">
              Inativa desde
              <input className="in" type="date" value={filters.inactiveSince} onChange={set('inactiveSince')} />
            </label>
            <label className="lb">
              Ativa desde
              <input className="in" type="date" value={filters.activeSince} onChange={set('activeSince')} />
            </label>
            <label className="lb">
              Motivo de desqualificação
              <input className="in" placeholder="contém…" value={filters.disqualifiedReason} onChange={set('disqualifiedReason')} />
            </label>
          </div>
        </div>
      </section>

      {companies.error && <ErrorBox error={companies.error} onRetry={companies.reload} />}
      {!companies.data && !companies.error && <Loading />}

      {companies.data && all.length === 0 && !Object.values(filters).some(Boolean) && (
        <section className="cd">
          <div className="cdb" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <b>Nenhuma empresa cadastrada ainda.</b>
            <span className="mt">Cadastre uma por vez ou importe um CSV. O domínio é a chave única: reimportar nunca duplica.</span>
            <div className="row" style={{ gap: 8 }}>
              <Link className="bt p" to="/empresas/nova">
                Nova empresa
              </Link>
              <Link className="bt" to="/empresas/nova?tab=csv">
                Importar CSV
              </Link>
            </div>
          </div>
        </section>
      )}

      {companies.data && view === 'lista' && all.length > 0 && (
        <div className="tbw" data-tour="companies-list">
          <table className="tb">
            <thead>
              <tr>
                {['Empresa', 'País', 'Func.', 'Tecnologias', 'Prior.', 'Pontuação · cobertura', 'Status', 'Contatos', 'Última interação', 'Próxima ação', 'Campanha'].map((label) => (
                  <th scope="col" key={label}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={11} className="mt">
                    Nenhuma empresa com esses filtros.
                  </td>
                </tr>
              )}
              {rows.map((company) => {
                const next = company.nextActionAt ? relativeDay(company.nextActionAt, today) : null;
                return (
                  <tr key={company.id}>
                    <td>
                      <Link className="nm" to={`/empresas/${company.domain}`}>
                        {company.name}
                      </Link>
                      <div className="mono mt">{company.domain}</div>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <Flag country={company.country} />
                      <span className="mono">{company.country}</span> <span className="mt">{company.region}</span>
                    </td>
                    <td className="mono">{company.employeeCount ?? '—'}</td>
                    <td style={{ minWidth: 210 }}>
                      <TechTags technologies={company.technologies} stack={meta.stack} />
                    </td>
                    <td>{company.priority ? PRIORITY_LABEL[company.priority] : <span className="mt">—</span>}</td>
                    <td style={{ minWidth: 150 }}>
                      <ScoreInline score={company.qualification ? company.qualification.score / company.qualification.maxScore : undefined} coverage={company.qualification?.coverage} />
                    </td>
                    <td>
                      <StatusChip status={company.status} />
                    </td>
                    <td className="mono">{company.contactCount}</td>
                    <td className="mt" style={{ whiteSpace: 'nowrap' }} title={company.lastInteractionAt ? utcLabel(company.lastInteractionAt) : undefined}>
                      {company.lastInteractionAt ? brDateTime(company.lastInteractionAt) : '—'}
                    </td>
                    <td style={{ minWidth: 140 }}>
                      {next ? (
                        <span title={company.nextActionNote}>
                          <span className={next.overdue ? 'ch am nd' : 'mt'}>{next.label}</span>
                          {company.nextActionNote && <div className="mt">{company.nextActionNote}</div>}
                        </span>
                      ) : (
                        <span className="mt">—</span>
                      )}
                    </td>
                    <td className="mono mt">{company.campaign ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {companies.data && view === 'kanban' && all.length > 0 && (
        <>
          <Banner color="bl">
            {pick
              ? `Movendo ${pick.name} (${statusLabel(pick.status)}). Colunas esmaecidas são transições inválidas; as destacadas aceitam soltar.`
              : 'Arraste um cartão (ou clique nele e depois em “Soltar aqui”). Colunas inválidas ficam esmaecidas; transições que exigem motivo abrem um diálogo.'}
          </Banner>
          <div className="kb" data-tour="companies-list">
            {KANBAN_ORDER.filter((status) => !statuses.length || statuses.includes(status)).map((status) => {
              const cards = (statuses.length ? rows : all).filter((company) => company.status === status);
              const canDrop = !!pick && targets.includes(status);
              const isOrigin = pick?.status === status;
              const dim = !!pick && !canDrop && !isOrigin;
              let note = '';
              if (pick && isOrigin) note = 'Origem';
              else if (pick?.status === 'qualified' && status === 'contacted') note = 'Automático no 1º envio; não é manual';
              else if (pick?.status === 'do_not_contact' && dim) note = 'Só por override para Inativa, na página da empresa';
              else if (!pick && (status === 'interested' || status === 'opportunity' || status === 'converted')) note = 'Sempre manual';
              return (
                <div
                  key={status}
                  className={`kcol${dim ? ' dim' : canDrop ? ' ok' : ''}${overColumn === status && canDrop ? ' drop' : ''}`}
                  title={dim && pick ? `Transição inválida: ${statusLabel(pick.status)} → ${statusLabel(status)}` : undefined}
                  onDragOver={(event) => {
                    if (!canDrop) return;
                    event.preventDefault();
                    setOverColumn(status);
                  }}
                  onDragLeave={() => setOverColumn((current) => (current === status ? null : current))}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (pick) drop(pick, status);
                  }}
                >
                  <div className="row" style={{ gap: 6 }}>
                    <StatusChip status={status} />
                    <span className="mt">{cards.length}</span>
                    <span className="sp" />
                    {canDrop && (
                      <button className="bt sm p" onClick={() => pick && drop(pick, status)}>
                        Soltar aqui
                      </button>
                    )}
                  </div>
                  {note && <div className="mt">{note}</div>}
                  {cards.map((company) => (
                    <div
                      key={company.id}
                      role="button"
                      tabIndex={0}
                      draggable
                      className={`kc${pick?.id === company.id ? ' sel' : ''}`}
                      aria-pressed={pick?.id === company.id}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'move';
                        setPick(company);
                      }}
                      onDragEnd={() => {
                        setOverColumn(null);
                        setPick((current) => (dialog ? current : null));
                      }}
                      onClick={() => setPick((current) => (current?.id === company.id ? null : company))}
                      onKeyDown={(event) => event.key === 'Enter' && setPick((current) => (current?.id === company.id ? null : company))}
                    >
                      <Link className="nm" to={`/empresas/${company.domain}`}>
                        {company.name}
                      </Link>
                      <span className="mt">
                        <Flag country={company.country} />
                        {company.region ?? company.country}
                        {company.employeeCount ? ` · ${company.employeeCount} func.` : ''}
                      </span>
                      <span className="mono mt">
                        {company.priority ? PRIORITY_LABEL[company.priority] : '—'}
                        {company.qualification ? ` · ${Math.round((company.qualification.score / company.qualification.maxScore) * 100)}%` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="mt">Todos os horários em Brasília; passe o mouse para ver o UTC. Nenhuma empresa é apagada: o histórico é somente inclusão.</div>

      {dialog && <StatusDialog company={dialog.company} to={dialog.to} onClose={() => setDialog(null)} onDone={companies.reload} />}
    </>
  );
};
