import { useEffect, useMemo, useState } from 'react';
import { type CandidateCheck, companyApi, type CompanyRow, importApi, type ImportResult, useApi } from '../api';
import { Banner, Chip, StatusChip, useAction, useMeta, useToast } from '../components/ui';
import { brToday } from '../format';
import { Link, navigate, useLocation } from '../router';
import { ContactForm, EvidenceForm } from './Company';

const TABS = [
  ['empresa', 'Nova empresa'],
  ['contato', 'Novo contato'],
  ['evidencia', 'Nova evidência'],
  ['csv', 'Importar CSV'],
] as const;
type Tab = (typeof TABS)[number][0];

const COUNTRIES = [
  ['GB', 'Reino Unido'],
  ['US', 'Estados Unidos'],
  ['CA', 'Canadá'],
  ['IE', 'Irlanda'],
  ['AU', 'Austrália'],
] as const;

// ---------------------------------------------------------------- Nova empresa

const useDebounced = <T,>(value: T, ms = 350) => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
};

const CompanyForm = () => {
  const { run, busy } = useAction();
  const [form, setForm] = useState({
    name: '',
    website: '',
    country: 'GB',
    region: '',
    segment: '',
    employeeCount: '',
    priority: '',
    lastVerifiedAt: brToday(),
    services: '',
    technologies: '',
    source: '',
    notes: '',
  });
  const [check, setCheck] = useState<CandidateCheck | null>(null);
  const website = useDebounced(form.website);
  const name = useDebounced(form.name);
  useEffect(() => {
    if (!website.trim() && !name.trim()) return setCheck(null);
    let current = true;
    companyApi
      .check(website, name)
      .then((result) => current && setCheck(result))
      .catch(() => current && setCheck(null));
    return () => {
      current = false;
    };
  }, [website, name]);
  const field = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const optional = (value: string) => value.trim() || undefined;

  const submit = async () => {
    const result = await run(
      () =>
        companyApi.add({
          name: form.name,
          website: form.website,
          country: form.country,
          region: optional(form.region),
          segment: optional(form.segment),
          employeeCount: form.employeeCount.trim() ? Number(form.employeeCount) : undefined,
          priority: optional(form.priority),
          lastVerifiedAt: optional(form.lastVerifiedAt),
          services: optional(form.services),
          technologies: form.technologies.split(/[,;]/).map((item) => item.trim()).filter(Boolean),
          source: optional(form.source),
          notes: optional(form.notes),
        }),
      { success: 'Empresa cadastrada como identified.' },
    );
    if (result) navigate(`/empresas/${result.company.domain}?tab=evidencias`);
  };

  const subdomainOf = check?.similar.find((other) => check.domain && check.domain.endsWith(`.${other.domain}`));
  const parentOf = check?.similar.find((other) => check.domain && other.domain.endsWith(`.${check.domain}`));
  const sameName = check?.similar.filter((other) => other !== subdomainOf && other !== parentOf) ?? [];

  return (
    <section className="cd">
      <div className="cdh">
        <h2 className="h">Nova empresa</h2>
        <span className="mt">O domínio é a chave única; ele é normalizado a partir da URL</span>
      </div>
      <div className="cdb" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="fg">
          <label className="lb">
            Nome
            <input className="in" value={form.name} onChange={field('name')} autoFocus />
          </label>
          <label className="lb">
            Site (URL)
            <input className="in mono" value={form.website} onChange={field('website')} placeholder="https://empresa.co.uk" />
          </label>
          <label className="lb" data-tour="register-domain">
            Domínio normalizado
            <input className="in mono" readOnly value={check?.domain ?? ''} style={{ background: 'var(--s2)' }} />
          </label>
        </div>
        {check?.error && form.website.trim() && <Banner color="rd" icon="alert">{check.error}</Banner>}
        {check?.existing && (
          <Banner color="rd" icon="alert">
            <b>Duplicada:</b> o domínio <span className="mono">{check.domain}</span> já pertence a{' '}
            <Link className="nm" to={`/empresas/${check.existing.domain}`} style={{ textDecoration: 'underline' }}>
              {check.existing.name}
            </Link>
            . Não é possível cadastrar de novo; abra a empresa existente.
          </Banner>
        )}
        {(subdomainOf || parentOf) && (
          <Banner color="am" icon="warn">
            <b>Possível duplicada (subdomínio):</b> <span className="mono">{check?.domain}</span> e{' '}
            <Link className="nm" to={`/empresas/${(subdomainOf ?? parentOf)!.domain}`} style={{ textDecoration: 'underline' }}>
              {(subdomainOf ?? parentOf)!.name}
            </Link>{' '}
            (<span className="mono">{(subdomainOf ?? parentOf)!.domain}</span>) são o mesmo domínio-base. Confira antes de salvar.
          </Banner>
        )}
        {sameName.length > 0 && (
          <Banner color="am" icon="warn">
            <b>Nome parecido:</b> já existe{' '}
            {sameName.map((other, index) => (
              <span key={other.id}>
                {index > 0 && ', '}
                <Link className="nm" to={`/empresas/${other.domain}`} style={{ textDecoration: 'underline' }}>
                  {other.name}
                </Link>
              </span>
            ))}
            .
          </Banner>
        )}
        <div className="fg">
          <label className="lb">
            País
            <select className="in" value={form.country} onChange={field('country')}>
              {COUNTRIES.map(([code, label]) => (
                <option key={code} value={code}>
                  {code} · {label}
                </option>
              ))}
            </select>
          </label>
          <label className="lb">
            Região / cidade
            <input className="in" value={form.region} onChange={field('region')} placeholder="Ex.: Manchester" />
          </label>
          <label className="lb">
            Segmento
            <input className="in" value={form.segment} onChange={field('segment')} placeholder="Ex.: agência digital" />
          </label>
          <label className="lb">
            Nº de funcionários
            <input className="in" type="number" min={1} value={form.employeeCount} onChange={field('employeeCount')} placeholder="5 a 50 pontua" />
          </label>
          <label className="lb">
            Prioridade
            <select className="in" value={form.priority} onChange={field('priority')}>
              <option value="">Definir depois</option>
              <option value="high">Alta</option>
              <option value="medium">Média</option>
              <option value="low">Baixa</option>
            </select>
          </label>
          <label className="lb">
            Última verificação
            <input className="in" type="date" value={form.lastVerifiedAt} onChange={field('lastVerifiedAt')} />
          </label>
        </div>
        <div className="fg">
          <label className="lb">
            Serviços
            <input className="in" value={form.services} onChange={field('services')} />
          </label>
          <label className="lb">
            Tecnologias
            <input className="in" value={form.technologies} onChange={field('technologies')} placeholder="Node.js, React, AWS" />
          </label>
          <label className="lb">
            Fonte do cadastro
            <input className="in" value={form.source} onChange={field('source')} placeholder="Site, Clutch, Companies House…" />
          </label>
        </div>
        <label className="lb">
          Notas
          <textarea className="in" rows={2} value={form.notes} onChange={field('notes')} />
        </label>
        <div className="row">
          <span className="mt">
            Status inicial: <StatusChip status="identified" /> · um evento “empresa cadastrada” será gravado.
          </span>
          <span className="sp" />
          <Link className="bt" to="/empresas">
            Cancelar
          </Link>
          <button className="bt p" data-tour="register-submit" disabled={busy || !form.name.trim() || !form.website.trim() || !!check?.existing || !!check?.error} onClick={submit}>
            Cadastrar empresa
          </button>
        </div>
      </div>
    </section>
  );
};

// ---------------------------------------------------------------- Contato e evidência (escolhe a empresa)

const CompanyPicker = ({ value, onChange }: { value: string; onChange: (domain: string) => void }) => {
  const companies = useApi<CompanyRow[]>('/api/companies');
  return (
    <label className="lb" style={{ maxWidth: 420 }}>
      Empresa
      <select className="in" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Escolha…</option>
        {(companies.data ?? [])
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((company) => (
            <option key={company.id} value={company.domain}>
              {company.name} · {company.domain}
            </option>
          ))}
      </select>
    </label>
  );
};

const ForCompany = ({ kind }: { kind: 'contato' | 'evidencia' }) => {
  const { query } = useLocation();
  const [domain, setDomain] = useState(query.get('empresa') ?? '');
  // Bumping the key remounts the form empty, ready for the next record.
  const [key, setKey] = useState(0);
  const reset = () => setKey((value) => value + 1);
  const done = async () => reset();
  return (
    <>
      <CompanyPicker value={domain} onChange={setDomain} />
      {domain ? (
        <>
          {kind === 'contato' ? (
            <ContactForm key={`${domain}-${key}`} companyDomain={domain} onDone={done} onCancel={reset} />
          ) : (
            <EvidenceForm key={`${domain}-${key}`} domain={domain} onDone={done} />
          )}
          <div className="row">
            <Link className="bt" to={`/empresas/${domain}${kind === 'contato' ? '?tab=contatos' : '?tab=evidencias'}`}>
              Abrir a empresa
            </Link>
          </div>
        </>
      ) : (
        <div className="mt">Escolha a empresa para continuar.</div>
      )}
    </>
  );
};

// ---------------------------------------------------------------- Importar CSV

const COMPANY_FIELDS = ['name', 'website', 'country', 'region', 'segment', 'employees', 'services', 'technologies', 'source', 'last_verified_at', 'notes'] as const;
const CONTACT_FIELDS = ['company', 'name', 'role', 'email', 'source', 'profile_url', 'notes'] as const;
const FIELD_LABEL: Record<string, string> = {
  name: 'Nome',
  website: 'Site → domínio',
  country: 'País',
  region: 'Região',
  segment: 'Segmento',
  employees: 'Funcionários',
  services: 'Serviços',
  technologies: 'Tecnologias (separadas por ;)',
  source: 'Fonte',
  last_verified_at: 'Última verificação',
  notes: 'Notas',
  company: 'Empresa (domínio)',
  role: 'Cargo',
  email: 'E-mail',
  profile_url: 'Perfil público',
};
const ALIASES: Record<string, string> = {
  site: 'website',
  url: 'website',
  domain: 'website',
  dominio: 'website',
  city: 'region',
  cidade: 'region',
  state: 'region',
  employee_count: 'employees',
  size: 'employees',
  funcionarios: 'employees',
  stack: 'technologies',
  tech: 'technologies',
  techs: 'technologies',
  tecnologias: 'technologies',
  nome: 'name',
  pais: 'country',
  fonte: 'source',
  cargo: 'role',
  title: 'role',
  linkedin: 'profile_url',
  profile: 'profile_url',
  company_domain: 'company',
  empresa: 'company',
};

const parseLine = (line: string): string[] => {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index]!;
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') (current += '"'), index++;
      else if (char === '"') quoted = false;
      else current += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') cells.push(current), (current = '');
    else current += char;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
};

const csvEscape = (value: string | number) => (/[",\n]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value));

const CsvImport = () => {
  const toast = useToast();
  const meta = useMeta();
  const [step, setStep] = useState(1);
  const [kind, setKind] = useState<'companies' | 'contacts'>('companies');
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [over, setOver] = useState(false);
  const [mapping, setMapping] = useState<string[]>([]);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);

  const fields: readonly string[] = kind === 'companies' ? COMPANY_FIELDS : CONTACT_FIELDS;
  const lines = useMemo(() => (file ? file.text.replace(/^﻿/, '').split(/\r?\n/) : []), [file]);
  const header = useMemo(() => (lines[0] ? parseLine(lines[0]) : []), [lines]);
  const sample = useMemo(() => (lines[1] ? parseLine(lines[1]) : []), [lines]);
  const dataRows = lines.slice(1).filter((line) => line.trim()).length;

  useEffect(() => {
    setMapping(
      header.map((column) => {
        const normalized = column.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '_');
        const target = (fields as readonly string[]).includes(normalized) ? normalized : ALIASES[normalized];
        return target && fields.includes(target) ? target : '';
      }),
    );
  }, [header, fields]);

  const mappedCsv = () => [mapping.map((target, index) => target || `ignored_${index}`).join(','), ...lines.slice(1)].join('\n');
  const duplicateTargets = mapping.filter((target, index) => target && mapping.indexOf(target) !== index);
  const required = kind === 'companies' ? ['name', 'website', 'country'] : ['company', 'name'];
  const missing = required.filter((field) => !mapping.includes(field));

  const readFile = (picked: File | undefined) => {
    if (!picked) return;
    if (!picked.name.toLowerCase().endsWith('.csv')) return toast('Escolha um arquivo .csv', 'rd');
    picked.text().then((text) => {
      setFile({ name: picked.name, text });
      setPreview(null);
      setResult(null);
    });
  };

  const runImport = async (dryRun: boolean) => {
    setBusy(true);
    try {
      const report = await importApi(kind, mappedCsv(), dryRun);
      if (dryRun) {
        setPreview(report);
        setStep(3);
      } else {
        setResult(report);
        setStep(4);
        await meta.reload();
      }
    } catch (error) {
      toast((error as Error).message, 'rd');
    } finally {
      setBusy(false);
    }
  };

  const downloadErrors = () => {
    const report = result ?? preview;
    if (!report) return;
    const rows = [['linha', 'registro', 'erro'], ...report.failed.map((item) => [item.line, item.label, item.error])];
    const blob = new Blob([rows.map((row) => row.map(csvEscape).join(',')).join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'linhas-com-erro.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const outcomes = preview
    ? [
        ...preview.created.map((item) => ({ ...item, color: 'gn', text: 'válida' })),
        ...preview.skipped.map((item) => ({ ...item, color: 'am', text: `duplicada · ${item.reason} (será pulada)` })),
        ...preview.failed.map((item) => ({ ...item, color: 'rd', text: `erro · ${item.error}` })),
      ].sort((a, b) => a.line - b.line)
    : [];

  const steps = ['Arquivo', 'Mapear colunas', 'Prévia', 'Relatório'];
  const canNext = step === 1 ? !!file && dataRows > 0 : step === 2 ? missing.length === 0 && duplicateTargets.length === 0 : step === 3 ? !!preview && preview.created.length > 0 : false;

  return (
    <>
      <div className="stp" aria-label="Etapas da importação">
        {steps.map((label, index) => (
          <span key={label} className={index + 1 === step ? 'on' : index + 1 < step ? 'done' : ''}>
            <b className="mono">{index + 1}</b> {label}
          </span>
        ))}
      </div>

      {step === 1 && (
        <section className="cd">
          <div className="cdh">
            <h2 className="h">1 · Arquivo</h2>
          </div>
          <div className="cdb" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label
              className={`drop-zone${over ? ' over' : ''}`}
              onDragOver={(event) => (event.preventDefault(), setOver(true))}
              onDragLeave={() => setOver(false)}
              onDrop={(event) => {
                event.preventDefault();
                setOver(false);
                readFile(event.dataTransfer.files[0]);
              }}
            >
              <input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={(event) => readFile(event.target.files?.[0])} />
              <div className="nm">Arraste um .csv aqui ou clique para escolher</div>
              <div className="mt" style={{ margin: '4px 0 10px' }}>
                Codificação UTF-8, separador vírgula, cabeçalho na primeira linha. Listas (tecnologias) separadas por ponto e vírgula.
              </div>
              {file && (
                <Chip color="gn" dot={false}>
                  {file.name} · {dataRows} linhas · {header.length} colunas
                </Chip>
              )}
            </label>
            <div className="row">
              <label className="lb">
                Tipo de importação
                <select className="in" value={kind} onChange={(event) => (setKind(event.target.value as 'companies' | 'contacts'), setPreview(null))}>
                  <option value="companies">Empresas</option>
                  <option value="contacts">Contatos (de empresas já cadastradas)</option>
                </select>
              </label>
            </div>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="cd">
          <div className="cdh">
            <h2 className="h">2 · Mapear colunas</h2>
            <span className="mt">
              Reconhecemos {mapping.filter(Boolean).length} de {header.length} colunas
            </span>
          </div>
          <div className="tbw" style={{ border: 0, borderRadius: 0 }}>
            <table className="tb">
              <thead>
                <tr>
                  <th scope="col">Coluna do CSV</th>
                  <th scope="col">Exemplo</th>
                  <th scope="col">Campo</th>
                </tr>
              </thead>
              <tbody>
                {header.map((column, index) => (
                  <tr key={`${column}-${index}`}>
                    <td className="mono">{column}</td>
                    <td className="mt">{sample[index] || '—'}</td>
                    <td>
                      <select className="in" value={mapping[index] ?? ''} onChange={(event) => setMapping((current) => current.map((value, position) => (position === index ? event.target.value : value)))}>
                        <option value="">Ignorar esta coluna</option>
                        {fields.map((field) => (
                          <option key={field} value={field}>
                            {FIELD_LABEL[field]}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(missing.length > 0 || duplicateTargets.length > 0) && (
            <div className="cdb">
              {missing.length > 0 && (
                <Banner color="rd" icon="alert">
                  Faltam campos obrigatórios: {missing.map((field) => FIELD_LABEL[field]).join(', ')}.
                </Banner>
              )}
              {duplicateTargets.length > 0 && (
                <Banner color="rd" icon="alert">
                  Campo usado em mais de uma coluna: {[...new Set(duplicateTargets)].map((field) => FIELD_LABEL[field]).join(', ')}.
                </Banner>
              )}
            </div>
          )}
        </section>
      )}

      {step === 3 && preview && (
        <>
          <div className="row" style={{ gap: 8 }}>
            <Chip color="gn">{preview.created.length} importáveis</Chip>
            <Chip color="am">{preview.skipped.length} duplicadas</Chip>
            <Chip color="rd">{preview.failed.length} com erro</Chip>
            <span className="mt">Prévia feita sem gravar nada.</span>
          </div>
          <div className="tbw">
            <table className="tb">
              <thead>
                <tr>
                  <th scope="col">Linha</th>
                  <th scope="col">Registro</th>
                  <th scope="col">Resultado</th>
                </tr>
              </thead>
              <tbody>
                {outcomes.map((item) => (
                  <tr key={item.line}>
                    <td className="mono">{item.line}</td>
                    <td className="mono">{item.label}</td>
                    <td>
                      <Chip color={item.color}>{item.text}</Chip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {step === 4 && result && (
        <section className="cd">
          <div className="cdh">
            <h2 className="h">4 · Relatório final</h2>
            <Chip color="gn" dot={false}>
              concluída
            </Chip>
          </div>
          <div className="cdb" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="fg">
              <div>
                <div className="mono" style={{ fontSize: 22 }}>
                  {result.created.length}
                </div>
                <div className="mt">{kind === 'companies' ? 'empresas criadas (identified)' : 'contatos criados'}</div>
              </div>
              <div>
                <div className="mono" style={{ fontSize: 22 }}>
                  {result.skipped.length}
                </div>
                <div className="mt">puladas por duplicidade</div>
              </div>
              <div>
                <div className="mono" style={{ fontSize: 22 }}>
                  {result.failed.length}
                </div>
                <div className="mt">linhas com erro (não importadas)</div>
              </div>
            </div>
            <div className="mt">Cada registro criado gravou um evento no histórico. Corrija as linhas com erro e reimporte: reimportar nunca duplica.</div>
            <div className="row">
              {result.failed.length > 0 && (
                <button className="bt" onClick={downloadErrors}>
                  Baixar linhas com erro (.csv)
                </button>
              )}
              <button className="bt" onClick={() => (setStep(1), setFile(null), setPreview(null), setResult(null))}>
                Nova importação
              </button>
              <Link className="bt p" to="/empresas">
                Ver empresas
              </Link>
            </div>
          </div>
        </section>
      )}

      {step < 4 && (
        <div className="row">
          <button className="bt" disabled={step === 1 || busy} onClick={() => setStep((value) => value - 1)}>
            Voltar
          </button>
          <span className="sp" />
          {step === 2 ? (
            <button className="bt p" disabled={!canNext || busy} onClick={() => runImport(true)}>
              {busy ? 'Conferindo…' : 'Ver prévia'}
            </button>
          ) : step === 3 ? (
            <button className="bt p" disabled={!canNext || busy} onClick={() => runImport(false)}>
              {busy ? 'Importando…' : `Importar ${preview?.created.length ?? 0}`}
            </button>
          ) : (
            <button className="bt p" disabled={!canNext} onClick={() => setStep(2)}>
              Continuar
            </button>
          )}
        </div>
      )}
    </>
  );
};

// ---------------------------------------------------------------- Página

export const RegisterPage = () => {
  const { query } = useLocation();
  const tab = (TABS.find(([key]) => key === query.get('tab'))?.[0] ?? 'empresa') as Tab;
  const empresa = query.get('empresa');
  const go = (key: Tab) => navigate(`/empresas/nova?tab=${key}${empresa ? `&empresa=${encodeURIComponent(empresa)}` : ''}`, { replace: true });
  return (
    <>
      <div className="row">
        <div>
          <Link className="mt" to="/empresas">
            ← Empresas
          </Link>
          <h1 className="t">Cadastros e importação</h1>
        </div>
      </div>
      <div className="tabs" role="tablist" data-tour="register-tabs">
        {TABS.map(([key, label]) => (
          <button key={key} role="tab" className={tab === key ? 'on' : ''} aria-selected={tab === key} onClick={() => go(key)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'empresa' && <CompanyForm />}
      {tab === 'contato' && <ForCompany kind="contato" />}
      {tab === 'evidencia' && <ForCompany kind="evidencia" />}
      {tab === 'csv' && <CsvImport />}
    </>
  );
};
