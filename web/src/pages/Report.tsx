import { useMemo, useState } from 'react';
import { type CampaignListItem, type Report, useApi } from '../api';
import { ErrorBox, KANBAN_ORDER, Loading, RateCard, STATUS_COLOR, StatusChip } from '../components/ui';

type Cohort = Report['byCampaign'][number];

const BAR_COLOR: Record<string, string> = { gy: 'var(--l2)', bl: 'var(--bf)', vi: 'var(--vf)', gn: 'var(--nf)', rd: 'var(--rf)', dr: 'var(--df)' };

const CohortTable = ({ title, rows, labels }: { title: string; rows: Cohort[]; labels?: Record<string, string> }) => {
  const max = Math.max(1, ...rows.map((row) => row.reached));
  return (
    <section className="cd" style={{ flex: '1 1 420px' }}>
      <div className="cdh">
        <h2 className="h">{title}</h2>
      </div>
      {rows.length === 0 ? (
        <div className="cdb mt">Sem primeiro contato no período.</div>
      ) : (
        <div className="tbw" style={{ border: 0, borderRadius: 0 }}>
          <table className="tb">
            <thead>
              <tr>
                <th scope="col">Grupo</th>
                <th scope="col">Abordados</th>
                <th scope="col">Respostas</th>
                <th scope="col">Interesse</th>
                <th scope="col">Taxa de resposta</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const rate = row.rates[0]!;
                return (
                  <tr key={row.label}>
                    <td className="mono">{labels?.[row.label] ?? row.label}</td>
                    <td style={{ minWidth: 140 }}>
                      <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                        <div className="bar" style={{ width: 80, flex: 'none' }}>
                          <i style={{ width: `${(row.reached / max) * 100}%` }} />
                        </div>
                        <span className="mono">{row.reached}</span>
                      </div>
                    </td>
                    <td className="mono">{row.responded}</td>
                    <td className="mono">{row.interested}</td>
                    <td className="mono" title={rate.definition}>
                      {rate.value === null ? '—' : `${rate.value}%`} <span className="mt">({rate.numerator}/{rate.denominator})</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

const csvEscape = (value: string | number) => (/[",\n]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value));

export const ReportPage = () => {
  const campaigns = useApi<CampaignListItem[]>('/api/campaigns');
  const [filters, setFilters] = useState({ campaign: '', from: '', to: '' });
  const url = useMemo(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    return `/api/report?${params.toString()}`;
  }, [filters]);
  const { data, error, reload } = useApi<Report>(url);

  const exportCsv = () => {
    if (!data) return;
    const rows: (string | number)[][] = [['seção', 'item', 'valor', 'numerador', 'denominador', 'definição']];
    for (const [key, value] of Object.entries(data.operational)) rows.push(['operacional', key, value, '', '', '']);
    for (const rate of data.rates) rows.push(['taxa', rate.name, rate.value ?? '', rate.numerator, rate.denominator, rate.definition]);
    for (const [group, list] of [
      ['campanha', data.byCampaign],
      ['país', data.byCountry],
      ['personalização', data.byPersonalization],
    ] as const)
      for (const cohort of list) rows.push([group, cohort.label, cohort.rates[0]?.value ?? '', cohort.responded, cohort.reached, 'resposta / abordados']);
    const blob = new Blob([rows.map((row) => row.map(csvEscape).join(',')).join('\n')], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `relatorio${filters.campaign ? `-${filters.campaign}` : ''}${filters.from ? `-${filters.from}` : ''}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const funnelMax = data ? Math.max(1, ...Object.values(data.companiesByStatus)) : 1;

  return (
    <>
      <div className="row">
        <div>
          <h1 className="t">Relatório</h1>
          <div className="sub">Coorte: contatos cujo primeiro e-mail saiu no período. Entrega e abertura não são medidas: o SMTP não informa.</div>
        </div>
        <span className="sp" />
        <button className="bt" disabled={!data} onClick={exportCsv}>
          Exportar CSV
        </button>
      </div>
      <section className="cd" data-tour="report-filters">
        <div className="cdb row" style={{ alignItems: 'flex-end' }}>
          <label className="lb">
            Campanha
            <select className="in" value={filters.campaign} onChange={(event) => setFilters({ ...filters, campaign: event.target.value })}>
              <option value="">Todas</option>
              {(campaigns.data ?? []).map((campaign) => (
                <option key={campaign.id}>{campaign.name}</option>
              ))}
            </select>
          </label>
          <label className="lb">
            De
            <input className="in" type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} />
          </label>
          <label className="lb">
            Até
            <input className="in" type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} />
          </label>
          <button className="bt gh" onClick={() => setFilters({ campaign: '', from: '', to: '' })}>
            Limpar
          </button>
        </div>
      </section>
      {error && <ErrorBox error={error} onRetry={reload} />}
      {!data && !error && <Loading />}
      {data && (
        <>
          {data.warnings.map((warning) => (
            <div className="bn am" key={warning}>
              {warning}
            </div>
          ))}
          <section className="cd" data-tour="report-rates">
            <div className="cdh">
              <h2 className="h">Taxas</h2>
              <span className="mt">Passe o mouse para ver a definição completa</span>
            </div>
            <div className="cdb" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 16 }}>
              {data.rates.map((rate) => (
                <RateCard key={rate.name} rate={rate} />
              ))}
            </div>
          </section>
          <div className="grid2">
            <section className="cd" style={{ flex: '1 1 420px' }}>
              <div className="cdh">
                <h2 className="h">Indicadores operacionais</h2>
              </div>
              {Object.entries(data.operational).map(([label, value]) => (
                <div className="li" key={label}>
                  <span style={{ flex: 1 }}>{label}</span>
                  <span className="mono">{value}</span>
                </div>
              ))}
            </section>
            <section className="cd" style={{ flex: '1 1 420px' }}>
              <div className="cdh">
                <h2 className="h">Empresas por status (agora)</h2>
              </div>
              {KANBAN_ORDER.map((status) => {
                const count = data.companiesByStatus[status];
                return (
                  <div className="li" key={status}>
                    <span style={{ flex: '0 0 130px' }}>
                      <StatusChip status={status} />
                    </span>
                    <div className="bar" style={{ flex: 1 }}>
                      <i style={{ width: `${(count / funnelMax) * 100}%`, background: BAR_COLOR[STATUS_COLOR[status] ?? 'gy'] }} />
                    </div>
                    <span className="mono" style={{ width: 30, textAlign: 'right' }}>
                      {count}
                    </span>
                  </div>
                );
              })}
            </section>
          </div>
          <div className="grid2" data-tour="report-groups">
            <CohortTable title="Por campanha" rows={data.byCampaign} />
            <CohortTable title="Por país" rows={data.byCountry} />
          </div>
          <CohortTable title="Genérica x personalizada" rows={data.byPersonalization} labels={{ generic: 'genérica', evidence_based: 'personalizada com evidência' }} />
          <div className="mt">Amostras pequenas não provam causa. Compare grupos só depois de dezenas de abordagens em cada um.</div>
        </>
      )}
    </>
  );
};
