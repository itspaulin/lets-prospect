import { useEffect, useState } from 'react';
import { companyApi, contactApi, prospectApi, type CompanyDetail, type CompanyStatus, type ContactView, type EvidenceKind, type InteractionType, useApi } from '../api';
import { StatusDialog } from '../components/StatusDialog';
import { Banner, Chip, Dialog, ErrorBox, Flag, Icon, type ICONS, Loading, PRIORITY_LABEL, StatusChip, statusLabel, TechTags, useAction, useMeta, useToast } from '../components/ui';
import { brDateTime, brToday, pct, shortDate, utcLabel } from '../format';
import { Link, navigate, useLocation } from '../router';

const TABS = [
  ['visao', 'Visão geral'],
  ['evidencias', 'Evidências'],
  ['contatos', 'Contatos'],
  ['qualificacao', 'Qualificação'],
  ['mensagens', 'Mensagens e respostas'],
  ['historico', 'Histórico'],
] as const;
type Tab = (typeof TABS)[number][0];

const EVIDENCE_KINDS: EvidenceKind[] = ['business_model', 'size', 'technology', 'recurring_work', 'demand_signal', 'other'];
const shortId = (id: string) => id.slice(0, 8);
const isUrl = (value?: string) => !!value && /^https?:\/\//i.test(value);

const Source = ({ value }: { value?: string }) =>
  !value ? (
    <span className="mt">sem fonte</span>
  ) : isUrl(value) ? (
    <a className="mono" href={value} target="_blank" rel="noreferrer noopener" style={{ textDecoration: 'underline' }}>
      {value.replace(/^https?:\/\//, '')}
    </a>
  ) : (
    <span>{value}</span>
  );

// ---------------------------------------------------------------- Visão geral

const Overview = ({ detail, reload }: { detail: CompanyDetail; reload: () => Promise<void> }) => {
  const meta = useMeta().data!;
  const { run, busy } = useAction();
  const { company } = detail;
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(company.notes ?? '');
  const [form, setForm] = useState(() => ({
    name: company.name,
    website: company.website,
    country: company.country,
    region: company.region ?? '',
    segment: company.segment ?? '',
    employeeCount: company.employeeCount?.toString() ?? '',
    services: company.services ?? '',
    technologies: company.technologies.join(', '),
    source: company.source ?? '',
    lastVerifiedAt: company.lastVerifiedAt ?? '',
    priority: company.priority ?? '',
  }));
  useEffect(() => setNotes(company.notes ?? ''), [company.notes]);
  const field = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const blankToNull = (value: string) => (value.trim() ? value.trim() : null);

  const save = async () => {
    const updated = await run(
      () =>
        companyApi.update(company.domain, {
          name: form.name,
          website: form.website,
          country: form.country,
          region: blankToNull(form.region),
          segment: blankToNull(form.segment),
          employeeCount: form.employeeCount.trim() ? Number(form.employeeCount) : null,
          services: blankToNull(form.services),
          technologies: form.technologies.split(/[,;]/).map((item) => item.trim()).filter(Boolean),
          source: blankToNull(form.source),
          lastVerifiedAt: blankToNull(form.lastVerifiedAt),
          priority: blankToNull(form.priority),
        }),
      { success: 'Cadastro atualizado. Campos alterados foram gravados no histórico.' },
    );
    if (!updated) return;
    setEditing(false);
    if (updated.domain !== company.domain) navigate(`/empresas/${updated.domain}`, { replace: true });
    else await reload();
  };

  return (
    <div className="grid2">
      <section className="cd" style={{ flex: '1 1 420px' }}>
        <div className="cdh">
          <h2 className="h">Cadastro</h2>
          <span className="sp" />
          {!editing && (
            <button className="bt sm" onClick={() => setEditing(true)}>
              Editar
            </button>
          )}
        </div>
        {editing ? (
          <div className="cdb" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="fg">
              <label className="lb">
                Nome
                <input className="in" value={form.name} onChange={field('name')} />
              </label>
              <label className="lb">
                Site (URL)
                <input className="in mono" value={form.website} onChange={field('website')} />
              </label>
              <label className="lb">
                País (ISO)
                <input className="in mono" value={form.country} onChange={field('country')} />
              </label>
              <label className="lb">
                Região / cidade
                <input className="in" value={form.region} onChange={field('region')} />
              </label>
              <label className="lb">
                Segmento
                <input className="in" value={form.segment} onChange={field('segment')} />
              </label>
              <label className="lb">
                Funcionários
                <input className="in" type="number" min={1} value={form.employeeCount} onChange={field('employeeCount')} />
              </label>
              <label className="lb">
                Prioridade
                <select className="in" value={form.priority} onChange={field('priority')}>
                  <option value="">—</option>
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
            <label className="lb">
              Serviços
              <input className="in" value={form.services} onChange={field('services')} />
            </label>
            <label className="lb">
              Tecnologias (separe por vírgula)
              <input className="in" value={form.technologies} onChange={field('technologies')} />
            </label>
            <label className="lb">
              Fonte do cadastro
              <input className="in" value={form.source} onChange={field('source')} />
            </label>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="bt" onClick={() => setEditing(false)}>
                Cancelar
              </button>
              <button className="bt p" disabled={busy} onClick={save}>
                Salvar
              </button>
            </div>
          </div>
        ) : (
          <dl className="kv cdb" style={{ margin: 0 }}>
            <dt>Domínio</dt>
            <dd className="mono">{company.domain}</dd>
            <dt>Site</dt>
            <dd>
              <Source value={company.website.includes('://') ? company.website : `https://${company.website}`} />
            </dd>
            <dt>País · região</dt>
            <dd>
              {company.country}
              {company.region ? ` · ${company.region}` : ''}
            </dd>
            <dt>Segmento</dt>
            <dd>{company.segment ?? <span className="mt">—</span>}</dd>
            <dt>Funcionários</dt>
            <dd>{company.employeeCount ?? <span className="mt">não informado</span>}</dd>
            <dt>Serviços</dt>
            <dd>{company.services ?? <span className="mt">—</span>}</dd>
            <dt>Tecnologias</dt>
            <dd>{company.technologies.length ? <TechTags technologies={company.technologies} stack={meta.stack} /> : <span className="mt">nenhuma</span>}</dd>
            <dt>Fonte</dt>
            <dd>
              <Source value={company.source} />
            </dd>
            <dt>Última verificação</dt>
            <dd>{company.lastVerifiedAt ? shortDate(company.lastVerifiedAt, true) : <span className="mt">—</span>}</dd>
            <dt>Motivo (desq./encerr.)</dt>
            <dd>{company.disqualificationReason ?? <span className="mt">Não se aplica ao status atual</span>}</dd>
            <dt>Cadastrada em</dt>
            <dd title={utcLabel(company.createdAt)}>{brDateTime(company.createdAt, true)}</dd>
          </dl>
        )}
      </section>
      <section className="cd" style={{ flex: '1 1 300px' }}>
        <div className="cdh">
          <h2 className="h">Notas</h2>
        </div>
        <div className="cdb">
          <textarea className="in" rows={7} value={notes} onChange={(event) => setNotes(event.target.value)} />
          <div className="row" style={{ marginTop: 6 }}>
            <span className="mt" style={{ flex: 1 }}>
              Edições de notas geram um evento no histórico.
            </span>
            <button
              className="bt sm"
              disabled={busy || notes === (company.notes ?? '')}
              onClick={() => run(() => companyApi.update(company.domain, { notes: notes.trim() || null }), { success: 'Notas salvas.', reload: [reload] })}
            >
              Salvar notas
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};

// ---------------------------------------------------------------- Evidências

export const EvidenceForm = ({ domain, onDone, onCancel }: { domain: string; onDone: () => Promise<void>; onCancel?: () => void }) => {
  const { run, busy } = useAction();
  const empty = { kind: 'business_model' as EvidenceKind, claim: '', certainty: 'verified', stance: 'supports', source: '', observedAt: brToday() };
  const [form, setForm] = useState(empty);
  const needsSource = form.certainty === 'verified' && !form.source.trim();
  const add = async () => {
    const created = await run(
      () =>
        companyApi.addEvidence(domain, {
          kind: form.kind,
          claim: form.claim,
          certainty: form.certainty,
          stance: form.stance,
          source: form.source.trim() || undefined,
          observedAt: form.observedAt || undefined,
        }),
      { success: 'Evidência registrada.', reload: [onDone] },
    );
    if (created) setForm(empty);
  };
  return (
    <section className="cd">
      <div className="cdh">
        <h2 className="h">Nova evidência</h2>
        <span className="mt">Fato só quando há fonte e data; o resto é hipótese</span>
      </div>
      <div className="cdb" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
        <label className="lb">
          Tipo
          <select className="in" value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as EvidenceKind })}>
            {EVIDENCE_KINDS.map((kind) => (
              <option key={kind}>{kind}</option>
            ))}
          </select>
        </label>
        <label className="lb" style={{ flex: '1 1 280px' }}>
          Afirmação
          <input className="in" value={form.claim} onChange={(event) => setForm({ ...form, claim: event.target.value })} placeholder="Uma frase factual, sem interpretação" />
        </label>
        <label className="lb">
          Certeza
          <select className="in" value={form.certainty} onChange={(event) => setForm({ ...form, certainty: event.target.value })}>
            <option value="verified">verified</option>
            <option value="hypothesis">hypothesis</option>
          </select>
        </label>
        <label className="lb">
          Posição
          <select className="in" value={form.stance} onChange={(event) => setForm({ ...form, stance: event.target.value })}>
            <option value="supports">supports</option>
            <option value="contradicts">contradicts</option>
          </select>
        </label>
        <label className="lb" style={{ flex: '1 1 200px' }}>
          Fonte (URL){form.certainty === 'verified' ? ' — obrigatória' : ''}
          <input className="in" placeholder="https://…" value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} />
        </label>
        <label className="lb">
          Observada em
          <input className="in" type="date" value={form.observedAt} onChange={(event) => setForm({ ...form, observedAt: event.target.value })} />
        </label>
        {onCancel && (
          <button className="bt" onClick={onCancel}>
            Cancelar
          </button>
        )}
        <button className="bt p" disabled={busy || !form.claim.trim() || needsSource} onClick={add} title={needsSource ? 'Fato verificado exige fonte' : undefined}>
          Adicionar
        </button>
      </div>
      <div className="cdb" style={{ paddingTop: 0 }}>
        <div className="mt">
          Marque <span className="mono">verified</span> só quando a fonte confirma a afirmação. Apenas fatos podem ser citados como motivo na mensagem; hipóteses valem 50% na
          qualificação.
        </div>
      </div>
    </section>
  );
};

const Evidences = ({ detail, reload }: { detail: CompanyDetail; reload: () => Promise<void> }) => {
  const toast = useToast();
  const groups = EVIDENCE_KINDS.map((kind) => ({ kind, items: detail.evidences.filter((evidence) => evidence.kind === kind) })).filter((group) => group.items.length);
  const copy = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      toast(`ID ${shortId(id)}… copiado.`);
    } catch {
      toast(`ID: ${id}`, 'bl');
    }
  };

  return (
    <>
      <EvidenceForm domain={detail.company.domain} onDone={reload} />
  {groups.length === 0 && (
        <Banner color="am" icon="warn">
          Nenhuma evidência ainda. Sem um fato <b>verified</b> de <span className="mono">business_model</span> a empresa não pode ir para qualified.
        </Banner>
      )}
      {groups.map((group) => (
        <section className="cd" key={group.kind}>
          <div className="cdh">
            <h2 className="h mono">{group.kind}</h2>
            <span className="cnt gy">{group.items.length}</span>
          </div>
          {group.items.map((evidence) => {
            const hypothesis = evidence.certainty === 'hypothesis';
            return (
              <div className={`ev${hypothesis ? ' hyp' : ''}`} key={evidence.id}>
                <button className="idb" onClick={() => copy(evidence.id)} title="Copiar ID para usar na personalização" aria-label={`Copiar ${evidence.id}`}>
                  {shortId(evidence.id)}
                </button>
                <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                  <div style={hypothesis ? { fontStyle: 'italic' } : undefined}>{evidence.claim}</div>
                  <div className="mt">
                    <Source value={evidence.source} /> · observada {shortDate(evidence.observedAt, true)}
                  </div>
                </div>
                <Chip color={hypothesis ? 'am' : 'gn'}>{hypothesis ? 'hipótese' : 'fato verificado'}</Chip>
                <Chip color={evidence.stance === 'contradicts' ? 'rd' : 'gy'} dot={false}>
                  {evidence.stance === 'contradicts' ? 'contra' : 'a favor'}
                </Chip>
              </div>
            );
          })}
        </section>
      ))}
      <div className="mt">Evidências não são editadas nem apagadas. Para corrigir, registre uma nova (por exemplo, um fato contrário).</div>
    </>
  );
};

// ---------------------------------------------------------------- Contatos

export const ContactForm = ({ companyDomain, contact, onDone, onCancel }: { companyDomain: string; contact?: ContactView; onDone: () => Promise<void>; onCancel: () => void }) => {
  const { run, busy } = useAction();
  const meta = useMeta().data!;
  const [form, setForm] = useState({
    name: contact?.name ?? '',
    role: contact?.role ?? '',
    email: contact?.email ?? '',
    source: contact?.source ?? '',
    profileUrl: contact?.profileUrl ?? '',
    verificationStatus: contact?.verificationStatus ?? 'unverified',
    notes: contact?.notes ?? '',
  });
  const [allowMismatch, setAllowMismatch] = useState(false);
  const domain = form.email.includes('@') ? form.email.split('@').pop()!.trim().toLowerCase() : '';
  const mismatch = !!domain && domain !== companyDomain && !domain.endsWith(`.${companyDomain}`);
  const missingSource = !!form.email.trim() && !form.source.trim();
  const decision = !!form.role && meta.decisionMakerRoles.some((role) => form.role.toLowerCase().includes(role));
  const field = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const value = (text: string) => (text.trim() ? text.trim() : contact ? null : undefined);

  const submit = async () => {
    const payload = {
      name: form.name,
      role: value(form.role),
      email: value(form.email),
      source: value(form.source),
      profileUrl: value(form.profileUrl),
      verificationStatus: form.verificationStatus,
      notes: value(form.notes),
      allowDomainMismatch: allowMismatch,
    };
    const saved = await run(() => (contact ? contactApi.update(contact.id, payload) : companyApi.addContact(companyDomain, payload)), {
      success: contact ? 'Contato atualizado.' : 'Contato adicionado.',
      reload: [onDone],
    });
    if (saved) onCancel();
  };

  return (
    <section className="cd">
      <div className="cdh">
        <h2 className="h">{contact ? `Editar ${contact.name}` : 'Novo contato'}</h2>
      </div>
      <div className="cdb" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="fg">
          <label className="lb">
            Nome
            <input className="in" value={form.name} onChange={field('name')} />
          </label>
          <label className="lb">
            Cargo {decision && <span className="ch bl nd">decisor</span>}
            <input className="in" list="roles" value={form.role} onChange={field('role')} placeholder="Founder, CTO…" />
          </label>
          <label className="lb">
            Perfil público (URL)
            <input className="in mono" value={form.profileUrl} onChange={field('profileUrl')} placeholder="https://…" />
          </label>
        </div>
        <div className="fg">
          <label className="lb">
            E-mail
            <input className="in mono" value={form.email} onChange={field('email')} />
          </label>
          <label className="lb">
            Fonte do e-mail (obrigatória com e-mail)
            <input className="in" value={form.source} onChange={field('source')} placeholder="De onde veio este endereço?" />
          </label>
          <label className="lb">
            Verificação
            <select className="in" value={form.verificationStatus} onChange={field('verificationStatus')}>
              <option>unverified</option>
              <option>verified</option>
              <option>invalid</option>
            </select>
          </label>
        </div>
        {mismatch && (
          <Banner color="am" icon="warn">
            <b>Domínio diferente:</b> <span className="mono">{domain}</span> não é o domínio da empresa (<span className="mono">{companyDomain}</span>). Pode estar certo
            (grupo, e-mail pessoal do fundador), mas confirme a fonte.
            <label className="row" style={{ gap: 6, marginTop: 6 }}>
              <input type="checkbox" checked={allowMismatch} onChange={(event) => setAllowMismatch(event.target.checked)} /> Confirmo que o e-mail é desta empresa
            </label>
          </Banner>
        )}
        {missingSource && <Banner color="rd" icon="alert">Informe de onde veio o e-mail. Sem fonte o contato não é salvo.</Banner>}
        <label className="lb">
          Notas
          <textarea className="in" rows={2} value={form.notes} onChange={field('notes')} />
        </label>
        <div className="row">
          <span className="sp" />
          <button className="bt" onClick={onCancel}>
            Cancelar
          </button>
          <button className="bt p" disabled={busy || !form.name.trim() || missingSource || (mismatch && !allowMismatch)} onClick={submit}>
            {contact ? 'Salvar' : 'Adicionar contato'}
          </button>
        </div>
      </div>
      <datalist id="roles">
        {['Founder', 'Co-Founder', 'CEO', 'CTO', 'Head of Engineering', 'Engineering Manager', 'Delivery Manager', 'VP Engineering'].map((role) => (
          <option key={role} value={role} />
        ))}
      </datalist>
    </section>
  );
};

const Contacts = ({ detail, reload }: { detail: CompanyDetail; reload: () => Promise<void> }) => {
  const { run, busy } = useAction();
  const [editing, setEditing] = useState<ContactView | 'new' | null>(detail.contacts.length ? null : 'new');
  const [unblock, setUnblock] = useState<ContactView | null>(null);
  const [forget, setForget] = useState<ContactView | null>(null);
  const [reason, setReason] = useState('');
  const [confirmText, setConfirmText] = useState('');

  const patch = (contact: ContactView, input: Record<string, unknown>, success: string) => run(() => contactApi.update(contact.id, input), { success, reload: [reload] });

  return (
    <>
      {editing && <ContactForm companyDomain={detail.company.domain} contact={editing === 'new' ? undefined : editing} onDone={reload} onCancel={() => setEditing(null)} />}
      <div className="grid2">
        {detail.contacts.map((contact) => (
          <section className="cd" style={{ flex: '1 1 380px' }} key={contact.id}>
            <div className="cdb" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="row" style={{ gap: 8 }}>
                <b>{contact.name}</b>
                {contact.role && (
                  <Chip color={contact.decisionMaker ? 'bl' : 'gy'} dot={false}>
                    {contact.role}
                    {contact.decisionMaker ? ' · decisor' : ''}
                  </Chip>
                )}
                {contact.email && (
                  <Chip color={contact.verificationStatus === 'verified' ? 'gn' : contact.verificationStatus === 'invalid' ? 'rd' : 'gy'} dot={false}>
                    e-mail {contact.verificationStatus}
                  </Chip>
                )}
                {contact.doNotContact && <Chip color="dr">não contatar</Chip>}
                {contact.suppressed && <Chip color="dr">suprimido</Chip>}
              </div>
              <div className="mono">{contact.email ?? <span className="mt">sem e-mail</span>}</div>
              {contact.domainMismatch && (
                <Banner color="am" icon="warn">
                  O domínio do e-mail é diferente do domínio da empresa (<span className="mono">{detail.company.domain}</span>). Confirme a fonte antes de usar.
                </Banner>
              )}
              <div className="mt">
                Fonte do e-mail: <Source value={contact.source} />
                {contact.profileUrl && (
                  <>
                    {' '}
                    · Perfil: <Source value={contact.profileUrl} />
                  </>
                )}{' '}
                · identificado em {shortDate(contact.identifiedAt)}
              </div>
              {contact.blockReason ? <div className="mt">Não apto para envio: {contact.blockReason}.</div> : <div className="mt">Apto para campanha.</div>}
              {contact.notes && <div className="mt">{contact.notes}</div>}
              <div className="row" style={{ gap: 6 }}>
                <button className="bt sm" onClick={() => setEditing(contact)}>
                  Editar
                </button>
                {contact.email && contact.verificationStatus !== 'verified' && (
                  <button className="bt sm" disabled={busy} onClick={() => patch(contact, { verificationStatus: 'verified' }, 'E-mail marcado como verificado.')}>
                    Marcar verificado
                  </button>
                )}
                {contact.email && contact.verificationStatus !== 'invalid' && (
                  <button className="bt sm" disabled={busy} onClick={() => patch(contact, { verificationStatus: 'invalid' }, 'E-mail marcado como inválido.')}>
                    Marcar inválido
                  </button>
                )}
                {contact.doNotContact ? (
                  <button className="bt sm" onClick={() => (setReason(''), setUnblock(contact))}>
                    Liberar…
                  </button>
                ) : (
                  <button className="bt sm" disabled={busy} onClick={() => patch(contact, { doNotContact: true }, 'Contato bloqueado para envio.')}>
                    Bloquear
                  </button>
                )}
                <span className="sp" />
                <button className="bt sm dn" onClick={() => (setReason(''), setConfirmText(''), setForget(contact))}>
                  Esquecer dados…
                </button>
              </div>
            </div>
          </section>
        ))}
      </div>
      {!editing && (
        <div className="row">
          <button className="bt p" onClick={() => setEditing('new')}>
            Novo contato
          </button>
        </div>
      )}

      {unblock && (
        <Dialog label="Liberar contato" onClose={() => setUnblock(null)}>
          <h2 className="h" style={{ fontSize: 17 }}>
            Liberar {unblock.name} para contato
          </h2>
          <div className="mt">A marcação de não contatar sai, mas supressões continuam valendo. O motivo fica no histórico.</div>
          <label className="lb">
            Motivo (obrigatório)
            <input className="in" value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="bt" onClick={() => setUnblock(null)}>
              Cancelar
            </button>
            <button
              className="bt p"
              disabled={busy || reason.trim().length < 3}
              onClick={async () => {
                const done = await run(() => contactApi.update(unblock.id, { doNotContact: false, reason }), { success: 'Contato liberado.', reload: [reload] });
                if (done) setUnblock(null);
              }}
            >
              Liberar
            </button>
          </div>
        </Dialog>
      )}

      {forget && (
        <Dialog label="Esquecer dados pessoais" onClose={() => setForget(null)}>
          <h2 className="h" style={{ fontSize: 17, color: 'var(--rf)' }}>
            Esquecer dados pessoais de {forget.name}
          </h2>
          <div>
            Nome, cargo, perfil público e notas serão apagados. <b>O endereço de e-mail continua bloqueado</b> na lista de supressão para impedir novo contato, e a
            própria exclusão fica registrada no histórico. Não dá para desfazer.
          </div>
          <label className="lb">
            Motivo (ex.: pedido do titular)
            <input className="in" value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <label className="lb">
            Digite <span className="mono">ESQUECER</span> para confirmar
            <input className="in" value={confirmText} onChange={(event) => setConfirmText(event.target.value)} />
          </label>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="bt" onClick={() => setForget(null)}>
              Cancelar
            </button>
            <button
              className="bt dn"
              disabled={busy || confirmText !== 'ESQUECER' || !reason.trim()}
              onClick={async () => {
                await run(() => contactApi.forget(forget.id, reason), { success: 'Dados pessoais apagados. O endereço segue suprimido.', reload: [reload] });
                setForget(null);
              }}
            >
              Apagar dados pessoais
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
};

// ---------------------------------------------------------------- Qualificação

const OUTCOME_LABEL = { met: 'Atendido', partial: 'Parcial', not_met: 'Não atendido', unknown: 'Sem dado' } as const;
const OUTCOME_COLOR = { met: 'gn', partial: 'am', not_met: 'rd', unknown: 'gy' } as const;

const Qualification = ({ detail, reload }: { detail: CompanyDetail; reload: () => Promise<void> }) => {
  const { run, busy } = useAction();
  const meta = useMeta().data!;
  const result = detail.company.qualification;
  const evaluate = () => run(() => companyApi.evaluate(detail.company.domain), { success: 'Qualificação recalculada e gravada no histórico.', reload: [reload] });

  if (!result)
    return (
      <section className="cd">
        <div className="cdb row">
          <span style={{ flex: 1 }}>Ainda não avaliada. A avaliação usa as evidências, os contatos e os pesos de config/scoring.json.</span>
          <button className="bt p" disabled={busy} onClick={evaluate}>
            Avaliar agora
          </button>
        </div>
      </section>
    );

  const ratio = result.score / result.maxScore;
  return (
    <>
      <section className="cd">
        <div className="cdh">
          <h2 className="h">Qualificação</h2>
          <span className="sp" />
          <span className="mt" title={utcLabel(result.evaluatedAt)}>
            Avaliada em {brDateTime(result.evaluatedAt)} · configuração v{result.configVersion}
          </span>
          <button className="bt sm" disabled={busy} onClick={evaluate}>
            Reavaliar
          </button>
        </div>
        <div className="cdb" style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center' }}>
          <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="row" style={{ gap: 8 }}>
              <span className="mono" style={{ fontSize: 22 }}>
                {pct(ratio)}
              </span>
              <span className="mt">
                pontuação ({result.score} de {result.maxScore} pontos)
              </span>
            </div>
            <div style={{ position: 'relative', height: 10, borderRadius: 5, background: 'var(--gb)' }} role="img" aria-label={`Pontuação ${pct(ratio)}, cobertura ${pct(result.coverage)}`}>
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: pct(result.coverage), borderRadius: 5, background: 'var(--bb)' }} />
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: pct(ratio), borderRadius: 5, background: 'var(--ac)' }} />
            </div>
            <div className="mt">Barra escura: pontos obtidos. Faixa clara: cobertura de {pct(result.coverage)} (peso com dado conhecido).</div>
          </div>
          <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div>
              Prioridade sugerida:{' '}
              {result.suggestedPriority ? (
                <Chip color={result.suggestedPriority === 'high' ? 'gn' : result.suggestedPriority === 'medium' ? 'bl' : 'gy'} dot={false}>
                  {PRIORITY_LABEL[result.suggestedPriority].toLowerCase()}
                </Chip>
              ) : (
                <Chip color="gy" dot={false}>
                  indefinida
                </Chip>
              )}{' '}
              <span className="mt">alta ≥ 70%, média ≥ 45%, com cobertura ≥ 50%</span>
            </div>
            <div className="mt">
              Requisito obrigatório (fato verificado de modelo de negócio):{' '}
              {result.missingRequired.length ? <b style={{ color: 'var(--rf)' }}>faltando ({result.missingRequired.join(', ')})</b> : <b style={{ color: 'var(--nf)' }}>atendido</b>}
            </div>
            {detail.company.priority !== result.suggestedPriority && result.suggestedPriority && (
              <div className="mt">
                Prioridade atual: {detail.company.priority ? PRIORITY_LABEL[detail.company.priority].toLowerCase() : 'nenhuma'}.{' '}
                <button
                  className="lnk"
                  disabled={busy}
                  onClick={() => run(() => companyApi.update(detail.company.domain, { priority: result.suggestedPriority }), { success: 'Prioridade atualizada.', reload: [reload] })}
                >
                  Usar a sugerida
                </button>
              </div>
            )}
          </div>
        </div>
      </section>
      <div className="tbw">
        <table className="tb">
          <thead>
            <tr>
              <th scope="col">Critério</th>
              <th scope="col">Peso</th>
              <th scope="col">Resultado</th>
              <th scope="col">Pontos</th>
              <th scope="col">Detalhe</th>
            </tr>
          </thead>
          <tbody>
            {result.criteria.map((criterion) => (
              <tr key={criterion.id}>
                <td>{criterion.label}</td>
                <td className="mono">{criterion.weight}</td>
                <td>
                  <Chip color={OUTCOME_COLOR[criterion.outcome]}>{OUTCOME_LABEL[criterion.outcome]}</Chip>
                </td>
                <td className="mono">{criterion.points}</td>
                <td>{criterion.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt">
        “Não atendido” aparece quando um fato contrário zera o critério; “Sem dado” não conta como cobertura. Hipótese vale 50%. Minha stack: {meta.stack.join(', ')}.
      </div>
    </>
  );
};

// ---------------------------------------------------------------- Mensagens e respostas

const Messages = ({ detail }: { detail: CompanyDetail }) => (
  <>
    {detail.messages.length === 0 ? (
      <section className="cd">
        <div className="cdb mt">Nenhuma mensagem ainda. Elas aparecem aqui quando a empresa entra numa campanha e recebe um rascunho.</div>
      </section>
    ) : (
      detail.messages.map((message) => (
        <section className="cd" key={message.id}>
          <div className="cdh">
            <b>
              Etapa {message.step} · {message.step === 0 ? 'primeiro contato' : 'follow-up'}
            </b>
            <StatusChip status={message.status} />
            <Chip color={message.personalization === 'evidence_based' ? 'gn' : 'gy'} dot={false}>
              {message.personalization}
            </Chip>
            {message.evidenceIds.length > 0 && <span className="mt mono">{message.evidenceIds.map(shortId).join(' · ')}</span>}
            <span className="sp" />
            <span className="mono mt">{message.campaign}</span>
            {message.contentHash && (
              <span className="mono mt" title="Hash do conteúdo aprovado; qualquer edição invalida">
                hash {message.contentHash.slice(0, 8)}
              </span>
            )}
          </div>
          <div className="cdb" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="mt">
              Para <span className="mono">{message.toEmail}</span>
              {message.approvedAt && (
                <>
                  {' '}
                  · aprovada em <span title={utcLabel(message.approvedAt)}>{brDateTime(message.approvedAt)}</span>
                </>
              )}
              {message.sentAt && (
                <>
                  {' '}
                  · enviada em <span title={utcLabel(message.sentAt)}>{brDateTime(message.sentAt)}</span>
                </>
              )}
            </div>
            {message.error && (
              <Banner color={message.status === 'unknown' ? 'am' : 'rd'} icon="alert">
                <span className="mono">{message.error}</span>
              </Banner>
            )}
            {message.cancelReason && <div className="mt">Cancelada: {message.cancelReason}</div>}
            <div className="mono" style={{ border: '1px solid var(--ln)', borderRadius: 6, padding: '10px 12px', background: 'var(--bg)', whiteSpace: 'pre-wrap' }}>
              <b>Subject:</b> {message.subject}
              {'\n\n'}
              {message.body}
            </div>
          </div>
        </section>
      ))
    )}
    <section className="cd">
      <div className="cdh">
        <h2 className="h">Respostas</h2>
      </div>
      {detail.replies.length === 0 ? (
        <div className="cdb mt">Nenhuma resposta registrada.</div>
      ) : (
        detail.replies.map((reply) => (
          <div className="li" key={reply.id}>
            <Chip color="vi">{reply.category}</Chip>
            <span style={{ flex: 1 }}>{reply.summary ?? <span className="mt">sem resumo</span>}</span>
            <span className="mt" title={utcLabel(reply.receivedAt)}>
              {brDateTime(reply.receivedAt)}
            </span>
          </div>
        ))
      )}
    </section>
  </>
);

// ---------------------------------------------------------------- Histórico

const EVENT: Record<InteractionType, { icon: keyof typeof ICONS; label: string; group: string }> = {
  company_created: { icon: 'company', label: 'Empresa cadastrada', group: 'empresa' },
  company_updated: { icon: 'company', label: 'Cadastro alterado', group: 'empresa' },
  status_changed: { icon: 'status', label: 'Status alterado', group: 'status' },
  contact_added: { icon: 'contact', label: 'Contato adicionado', group: 'contatos' },
  contact_updated: { icon: 'contact', label: 'Contato alterado', group: 'contatos' },
  personal_data_erased: { icon: 'contact', label: 'Dados pessoais apagados', group: 'contatos' },
  evidence_added: { icon: 'evidence', label: 'Evidência registrada', group: 'evidencias' },
  qualification_evaluated: { icon: 'report', label: 'Qualificação avaliada', group: 'empresa' },
  next_action_set: { icon: 'note', label: 'Próxima ação', group: 'notas' },
  note_added: { icon: 'note', label: 'Nota', group: 'notas' },
  campaign_target_added: { icon: 'campaign', label: 'Entrou em campanha', group: 'mensagens' },
  message_drafted: { icon: 'message', label: 'Rascunho criado', group: 'mensagens' },
  message_approved: { icon: 'message', label: 'Mensagem aprovada', group: 'mensagens' },
  message_cancelled: { icon: 'message', label: 'Mensagem cancelada', group: 'mensagens' },
  message_sent: { icon: 'message', label: 'Mensagem enviada', group: 'mensagens' },
  message_failed: { icon: 'message', label: 'Envio falhou', group: 'mensagens' },
  message_unknown: { icon: 'message', label: 'Envio sem confirmação', group: 'mensagens' },
  message_resolved: { icon: 'message', label: 'Envio conciliado', group: 'mensagens' },
  reply_recorded: { icon: 'reply', label: 'Resposta registrada', group: 'mensagens' },
  reply_corrected: { icon: 'reply', label: 'Resposta corrigida', group: 'mensagens' },
  suppressed: { icon: 'suppress', label: 'Suprimido', group: 'contatos' },
};

const HISTORY_FILTERS = [
  ['todos', 'Todos'],
  ['status', 'Status'],
  ['empresa', 'Empresa'],
  ['contatos', 'Contatos'],
  ['evidencias', 'Evidências'],
  ['mensagens', 'Mensagens'],
  ['notas', 'Notas'],
] as const;

const History = ({ detail, reload }: { detail: CompanyDetail; reload: () => Promise<void> }) => {
  const [filter, setFilter] = useState<string>('todos');
  const [note, setNote] = useState('');
  const { run, busy } = useAction();
  const events = detail.interactions.filter((event) => filter === 'todos' || EVENT[event.type].group === filter);
  return (
    <section className="cd">
      <div className="cdh">
        <h2 className="h">Histórico</h2>
        <span className="mt">Somente inclusão · nada é apagado</span>
        <span className="sp" />
        {HISTORY_FILTERS.map(([key, label]) => (
          <button key={key} className={`bt sm${filter === key ? ' on' : ''}`} onClick={() => setFilter(key)}>
            {label}
          </button>
        ))}
      </div>
      <div className="cdb row" style={{ borderBottom: '1px solid var(--ln)' }}>
        <input className="in" style={{ flex: 1 }} placeholder="Nota rápida no histórico (ex.: respondeu no LinkedIn)" value={note} onChange={(event) => setNote(event.target.value)} />
        <button
          className="bt sm"
          disabled={busy || !note.trim()}
          onClick={async () => {
            await run(() => companyApi.note(detail.company.domain, note), { success: 'Nota registrada.', reload: [reload] });
            setNote('');
          }}
        >
          Registrar nota
        </button>
      </div>
      <div className="cdb" style={{ display: 'flex', flexDirection: 'column' }}>
        {events.length === 0 && <div className="mt">Nada neste filtro.</div>}
        {events.map((event) => (
          <div className="tle" key={event.id}>
            <div className="tlc">
              <span className="tli">
                <Icon name={EVENT[event.type].icon} />
              </span>
              <i />
            </div>
            <details style={{ flex: 1, paddingBottom: 12 }}>
              <summary>
                <b>{EVENT[event.type].label}</b>{' '}
                <span className="mt" title={utcLabel(event.occurredAt)}>
                  {brDateTime(event.occurredAt, true)}
                </span>
                <div>{event.summary}</div>
              </summary>
              {event.data && (
                <pre className="mono mt" style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(event.data, null, 2)}
                </pre>
              )}
            </details>
          </div>
        ))}
      </div>
    </section>
  );
};

// ---------------------------------------------------------------- Página

export const CompanyPage = ({ refParam }: { refParam: string }) => {
  const meta = useMeta().data!;
  const { query } = useLocation();
  const tab = (TABS.find(([key]) => key === query.get('tab'))?.[0] ?? 'visao') as Tab;
  const { data, error, reload } = useApi<CompanyDetail>(`/api/companies/${encodeURIComponent(refParam)}`);
  const { run, busy } = useAction();
  const toast = useToast();
  const [menu, setMenu] = useState(false);
  const [dialog, setDialog] = useState<{ to: CompanyStatus; override?: boolean } | null>(null);
  const [nextAt, setNextAt] = useState('');
  const [nextNote, setNextNote] = useState('');

  useEffect(() => {
    setNextAt(data?.company.nextActionAt ?? '');
    setNextNote(data?.company.nextActionNote ?? '');
  }, [data?.company.nextActionAt, data?.company.nextActionNote]);

  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const { company } = data;
  const moves = data.allowedTransitions.filter((to) => !(company.status === 'qualified' && to === 'contacted'));
  const reasonRequired = meta.reasonRequired as string[];
  const result = company.qualification;
  const setTab = (key: Tab) => navigate(`/empresas/${company.domain}${key === 'visao' ? '' : `?tab=${key}`}`, { replace: true });
  const counts: Partial<Record<Tab, number>> = { evidencias: data.evidences.length, contatos: data.contacts.length, mensagens: data.messages.length + data.replies.length };

  return (
    <>
      <Link className="mt" to="/empresas">
        ← Empresas
      </Link>

      <section className="cd">
        <div className="cdb" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="row">
            <div style={{ minWidth: 0 }}>
              <div className="row" style={{ gap: 10 }}>
                <h1 className="t">{company.name}</h1>
                <StatusChip status={company.status} />
                {company.priority && (
                  <Chip color="gy" dot={false}>
                    prioridade {PRIORITY_LABEL[company.priority].toLowerCase()}
                  </Chip>
                )}
              </div>
              <div className="sub">
                <span className="mono">{company.domain}</span> · <Flag country={company.country} />
                {company.country}
                {company.region ? ` · ${company.region}` : ''}
                {company.employeeCount ? ` · ${company.employeeCount} funcionários` : ''}
                {data.campaign && (
                  <>
                    {' '}
                    · campanha <span className="mono">{data.campaign.name}</span> ({statusLabel(data.campaign.status)})
                  </>
                )}
              </div>
            </div>
            <div className="sp" />
            {company.status === 'identified' && meta.prospecting.ai && (
              <button
                className="bt"
                disabled={busy}
                title="A IA lê o site e qualifica ou desqualifica, com citações conferidas"
                onClick={() =>
                  run(async () => {
                    const result = await prospectApi.qualify(company.domain);
                    toast(`IA: ${result.outcome === 'qualified' ? 'qualificada' : result.outcome === 'disqualified' ? 'desqualificada' : 'precisa de revisão'}. ${result.reason}`, result.outcome === 'qualified' ? 'gn' : 'am');
                  }, { reload: [reload] })
                }
              >
                Qualificar com IA
              </button>
            )}
            {company.status === 'qualified' && meta.prospecting.hunter && !data.contacts.some((contact) => contact.email && !contact.doNotContact) && (
              <button
                className="bt"
                disabled={busy}
                title="Busca CEO, CTO e sócios no Hunter. Gasta 1 crédito se achar alguém."
                onClick={() =>
                  run(async () => {
                    const report = await prospectApi.findContacts(company.domain);
                    const entry = report.companies[0];
                    toast(entry?.added.length ? `${entry.added.length} decisor(es) cadastrado(s). ${report.spentCredits} crédito gasto.` : `${entry?.note ?? 'Nenhum decisor'}. ${report.spentCredits} crédito gasto.`, entry?.added.length ? 'gn' : 'am');
                  }, { reload: [reload] })
                }
              >
                Buscar decisores (1 crédito)
              </button>
            )}
            <button className="bt" onClick={() => setMenu((open) => !open)} aria-expanded={menu} data-tour="company-status">
              Mudar status ▾
            </button>
          </div>

          {menu && (
            <div className="cd" style={{ background: 'var(--s2)' }}>
              <div className="cdb" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {company.status === 'do_not_contact' ? (
                  <>
                    <div className="mt">
                      <b>Não contatar</b> não tem transições normais. Só é possível ir para <b>Inativa</b> por override, com motivo; a
                      empresa continua fora de qualquer fila de envio.
                    </div>
                    <div>
                      <button className="bt dn sm" onClick={() => (setMenu(false), setDialog({ to: 'inactive', override: true }))}>
                        Override para Inativa…
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mt">
                      Só as transições permitidas a partir de <b>{statusLabel(company.status)}</b>:
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      {moves.map((to) => (
                        <button
                          key={to}
                          className={`ch ${to === 'do_not_contact' ? 'dr' : ''}`}
                          style={{ border: '1px solid currentColor', cursor: 'pointer', height: 24 }}
                          onClick={() => (setMenu(false), setDialog({ to }))}
                        >
                          {statusLabel(to)}
                          {reasonRequired.includes(to) ? ' *' : ''}
                        </button>
                      ))}
                    </div>
                    <div className="mt">Qualificada → Contatada acontece sozinho no 1º envio. Interessada, Oportunidade e Convertida são sempre manuais. * exige motivo.</div>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="row" style={{ gap: 16, alignItems: 'flex-end', borderTop: '1px solid var(--ln)', paddingTop: 12 }} data-tour="company-next">
            <label className="lb">
              Próxima ação (data)
              <input className="in" type="date" value={nextAt} onChange={(event) => setNextAt(event.target.value)} />
            </label>
            <label className="lb" style={{ flex: '1 1 280px' }}>
              Nota
              <input className="in" value={nextNote} onChange={(event) => setNextNote(event.target.value)} placeholder="O que fazer nessa data" />
            </label>
            <button
              className="bt"
              disabled={busy || !nextAt || (nextAt === (company.nextActionAt ?? '') && nextNote === (company.nextActionNote ?? ''))}
              onClick={() => run(() => companyApi.nextAction(company.domain, nextAt, nextNote), { success: 'Próxima ação salva.', reload: [reload] })}
            >
              Salvar
            </button>
            {company.nextActionAt && (
              <button className="bt gh" disabled={busy} onClick={() => run(() => companyApi.nextAction(company.domain, null), { success: 'Próxima ação removida.', reload: [reload] })}>
                Limpar
              </button>
            )}
            <div className="lb">
              Pontuação
              <span className="row" style={{ gap: 8 }}>
                {result ? (
                  <>
                    <span className="mono" style={{ fontSize: 17, color: 'var(--ink)' }}>
                      {pct(result.score / result.maxScore)}
                    </span>
                    <span className="mt">cobertura {pct(result.coverage)}</span>
                  </>
                ) : (
                  <span className="mt">não avaliada</span>
                )}
              </span>
            </div>
          </div>
        </div>
      </section>

      <div className="tabs" role="tablist" data-tour="company-tabs">
        {TABS.map(([key, label]) => (
          <button key={key} role="tab" className={tab === key ? 'on' : ''} aria-selected={tab === key} onClick={() => setTab(key)}>
            {label}
            {counts[key] ? <span className="mt"> · {counts[key]}</span> : null}
          </button>
        ))}
      </div>

      {tab === 'visao' && <Overview key={company.updatedAt} detail={data} reload={reload} />}
      {tab === 'evidencias' && <Evidences detail={data} reload={reload} />}
      {tab === 'contatos' && <Contacts detail={data} reload={reload} />}
      {tab === 'qualificacao' && <Qualification detail={data} reload={reload} />}
      {tab === 'mensagens' && <Messages detail={data} />}
      {tab === 'historico' && <History detail={data} reload={reload} />}

      {dialog && <StatusDialog company={company} to={dialog.to} override={dialog.override} onClose={() => setDialog(null)} onDone={reload} />}
    </>
  );
};
