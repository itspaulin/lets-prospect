import { useState } from 'react';
import { campaignApi, type CampaignListItem, useApi } from '../api';
import { Banner, ErrorBox, Loading, StatusChip, useAction } from '../components/ui';
import { brDateTime, utcLabel } from '../format';
import { Link, navigate } from '../router';

const NewCampaign = ({ onCancel }: { onCancel: () => void }) => {
  const { run, busy } = useAction();
  const [form, setForm] = useState({ name: '', market: 'BR', segment: '', criteria: '', notes: '' });
  const field = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));
  const submit = async () => {
    const created = await run(() => campaignApi.create(form), { success: 'Campanha criada em draft. Agora escreva o template.' });
    if (created) navigate(`/campanhas/${encodeURIComponent(created.name)}?etapa=2`);
  };
  return (
    <section className="cd">
      <div className="cdh">
        <h2 className="h">Nova campanha</h2>
        <span className="mt">Nasce em draft. Só envia depois que você aprovar o template e ativar.</span>
      </div>
      <div className="cdb" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="fg">
          <label className="lb">
            Nome interno
            <input className="in mono" value={form.name} onChange={field('name')} placeholder="uk-agencies-nov" autoFocus />
          </label>
          <label className="lb">
            Mercado
            <select className="in" value={form.market} onChange={field('market')}>
              {['BR', 'GB', 'US', 'CA', 'IE', 'AU'].map((code) => (
                <option key={code}>{code}</option>
              ))}
            </select>
          </label>
          <label className="lb">
            Segmento
            <input className="in" list="segmentos" value={form.segment} onChange={field('segment')} placeholder="software house ou consultoria de TI" title={'Escolha "software house" ou "consultoria de TI" para a campanha receber só esse tipo de empresa. Outro texto é só uma descrição.'} />
            <datalist id="segmentos">
              <option value="software house" />
              <option value="consultoria de TI" />
            </datalist>
          </label>
          <label className="lb">
            Critérios de seleção
            <input className="in" value={form.criteria} onChange={field('criteria')} placeholder="qualified, prioridade alta" />
          </label>
        </div>
        <label className="lb">
          Notas
          <textarea className="in" rows={2} value={form.notes} onChange={field('notes')} />
        </label>
        <div className="row">
          <span className="sp" />
          <button className="bt" onClick={onCancel}>
            Cancelar
          </button>
          <button className="bt p" disabled={busy || !form.name.trim()} onClick={submit}>
            Criar campanha
          </button>
        </div>
      </div>
    </section>
  );
};

export const CampaignsPage = () => {
  const { data, error, reload } = useApi<CampaignListItem[]>('/api/campaigns');
  const [creating, setCreating] = useState(false);
  return (
    <>
      <div className="row">
        <div>
          <h1 className="t">Campanhas</h1>
          <div className="sub">Cada campanha agrupa empresas, templates aprovados e resultados para comparar abordagens.</div>
        </div>
        <span className="sp" />
        {!creating && (
          <button className="bt p" onClick={() => setCreating(true)} data-tour="campaigns-new">
            Nova campanha
          </button>
        )}
      </div>
      {creating && <NewCampaign onCancel={() => setCreating(false)} />}
      {error && <ErrorBox error={error} onRetry={reload} />}
      {!data && !error && <Loading />}
      {data?.length === 0 && !creating && (
        <Banner color="bl">
          Nenhuma campanha ainda. Crie uma, escreva o template da etapa 0 (há modelos em <span className="mono">templates/</span>), aprove e ative.
        </Banner>
      )}
      {data && data.length > 0 && (
        <div className="tbw" data-tour="campaigns-list">
          <table className="tb">
            <thead>
              <tr>
                {['Campanha', 'Mercado', 'Status', 'Empresas', 'Rascunhos', 'Aprovadas', 'Enviadas', 'Falhas · desconhecidas', 'Respostas', 'Interessados', 'Taxa de resposta', 'Criada'].map((label) => (
                  <th key={label} scope="col">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((campaign) => {
                const response = campaign.metrics.rates[0];
                return (
                  <tr key={campaign.id}>
                    <td>
                      <Link className="nm mono" to={`/campanhas/${encodeURIComponent(campaign.name)}`}>
                        {campaign.name}
                      </Link>
                      {campaign.segment && <div className="mt">{campaign.segment}</div>}
                    </td>
                    <td className="mono">{campaign.market ?? '—'}</td>
                    <td>
                      <StatusChip status={campaign.status} />
                    </td>
                    <td className="mono">{campaign.metrics.targets}</td>
                    <td className="mono">{campaign.metrics.drafts}</td>
                    <td className="mono">{campaign.metrics.approved}</td>
                    <td className="mono">{campaign.metrics.sent}</td>
                    <td className="mono">
                      {campaign.metrics.failed} · {campaign.metrics.unknown}
                    </td>
                    <td className="mono">{campaign.metrics.replies}</td>
                    <td className="mono">{campaign.metrics.interested}</td>
                    <td className="mono" title={response?.definition}>
                      {response?.value === null || !response ? '—' : `${response.value}%`} <span className="mt">({response?.numerator ?? 0}/{response?.denominator ?? 0})</span>
                    </td>
                    <td className="mt" title={utcLabel(campaign.createdAt)}>
                      {brDateTime(campaign.createdAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};
