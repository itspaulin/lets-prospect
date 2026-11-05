import { useState } from 'react';
import { api, type SuppressionItem, useApi } from '../api';
import { Banner, Chip, Dialog, ErrorBox, Loading, useAction } from '../components/ui';
import { brDateTime, utcLabel } from '../format';
import { Link } from '../router';

export const SuppressionsPage = () => {
  const { data, error, reload } = useApi<SuppressionItem[]>('/api/suppressions');
  const { run, busy } = useAction();
  const [check, setCheck] = useState('');
  const [checked, setChecked] = useState<{ value: string; suppressed: boolean; by?: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ kind: 'email', value: '', reason: '' });
  const KIND: Record<string, string> = { email: 'e-mail', domain: 'domínio', phone: 'telefone' };

  const verify = async () => {
    const result = await run(() => api.get<{ value: string; suppressed: boolean; by?: string }>(`/api/suppressions/check?value=${encodeURIComponent(check)}`));
    if (result) setChecked(result);
  };

  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;

  return (
    <>
      <div className="row">
        <div>
          <h1 className="t">Supressões</h1>
          <div className="sub">E-mails, domínios e telefones que nunca mais recebem mensagens. Consultadas antes de cada envio.</div>
        </div>
        <span className="sp" />
        <button className="bt p" data-tour="supp-add" onClick={() => (setForm({ kind: 'email', value: '', reason: '' }), setAdding(true))}>
          Adicionar supressão
        </button>
      </div>

      <Banner color="gy" icon="info">
        <b>Por que não dá para remover:</b> pedido de descadastro é permanente, e o banco recusa apagar supressões. Só o hash do endereço fica guardado, então o bloqueio
        continua mesmo depois de apagar os dados pessoais do contato.
      </Banner>

      <section className="cd" data-tour="supp-check">
        <div className="cdb row" style={{ alignItems: 'flex-end' }}>
          <label className="lb" style={{ flex: '1 1 320px' }}>
            Verificar um e-mail, domínio ou telefone
            <input className="in mono" value={check} onChange={(event) => (setCheck(event.target.value), setChecked(null))} onKeyDown={(event) => event.key === 'Enter' && check.trim() && verify()} />
          </label>
          <button className="bt" disabled={busy || !check.trim()} onClick={verify}>
            Verificar
          </button>
          {checked && (
            <Chip color={checked.suppressed ? 'dr' : 'gn'}>
              {checked.suppressed ? `suprimido (${checked.by === 'domain' ? 'pelo domínio' : checked.by === 'phone' ? 'pelo telefone' : 'pelo e-mail'})` : 'livre'} · {checked.value}
            </Chip>
          )}
        </div>
      </section>

      <div className="tbw" data-tour="supp-list">
        <table className="tb">
          <thead>
            <tr>
              {['Tipo', 'Corresponde a', 'Motivo', 'Desde', 'Hash'].map((label) => (
                <th key={label} scope="col">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 && (
              <tr>
                <td colSpan={5} className="mt">
                  Nenhuma supressão.
                </td>
              </tr>
            )}
            {data.map((item) => (
              <tr key={item.id}>
                <td>
                  <Chip color="dr">{KIND[item.kind] ?? item.kind}</Chip>
                </td>
                <td>
                  {item.lead ? (
                    <>
                      {item.lead.name} <span className="mono mt">{item.lead.phone}</span>
                    </>
                  ) : item.contact ? (
                    <>
                      {item.contact.name} <span className="mono mt">{item.contact.email}</span>
                    </>
                  ) : item.kind === 'domain' && item.company ? (
                    <span className="mono">{item.company.domain}</span>
                  ) : (
                    <span className="mt">sem contato cadastrado (ou dados apagados)</span>
                  )}
                  {item.company && (
                    <div>
                      <Link className="mt" to={`/empresas/${item.company.domain}`} style={{ textDecoration: 'underline' }}>
                        {item.company.name}
                      </Link>
                    </div>
                  )}
                </td>
                <td>{item.reason}</td>
                <td title={utcLabel(item.createdAt)}>{brDateTime(item.createdAt, true)}</td>
                <td className="mono mt">{item.hashPrefix}…</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {adding && (
        <Dialog label="Adicionar supressão" onClose={() => setAdding(false)}>
          <h2 className="h" style={{ fontSize: 17 }}>
            Adicionar supressão
          </h2>
          <div className="row">
            {(['email', 'domain', 'phone'] as const).map((kind) => (
              <label key={kind} className={`rad${form.kind === kind ? ' sel' : ''}`}>
                <input type="radio" checked={form.kind === kind} onChange={() => setForm({ ...form, kind })} />
                <span>
                  <b>{kind === 'email' ? 'E-mail' : kind === 'phone' ? 'Telefone' : 'Domínio inteiro'}</b>
                  <div className="mt">{kind === 'email' ? 'Bloqueia só este endereço.' : kind === 'phone' ? 'Bloqueia este número no WhatsApp.' : 'Bloqueia qualquer endereço deste domínio.'}</div>
                </span>
              </label>
            ))}
          </div>
          <label className="lb">
            {form.kind === 'email' ? 'E-mail' : form.kind === 'phone' ? 'Telefone com DDD' : 'Domínio ou URL'}
            <input className="in mono" value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })} />
          </label>
          <label className="lb">
            Motivo
            <input className="in" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="Ex.: pediu por LinkedIn para não ser contatado" />
          </label>
          <Banner color="dr" icon="warn">
            Permanente: não há como desfazer.
          </Banner>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="bt" onClick={() => setAdding(false)}>
              Cancelar
            </button>
            <button
              className="bt dn"
              disabled={busy || !form.value.trim() || form.reason.trim().length < 3}
              onClick={async () => {
                const result = await run(() => api.post<{ inserted: boolean }>('/api/suppressions', form), { reload: [reload] });
                if (result) {
                  setAdding(false);
                  setChecked(null);
                }
              }}
            >
              Suprimir para sempre
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
};
