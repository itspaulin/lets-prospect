import { useState } from 'react';
import { campaignApi, type FollowUpItem, useApi } from '../api';
import { Banner, Chip, ErrorBox, Loading, useAction, useMeta } from '../components/ui';
import { brToday, relativeDay, shortDate } from '../format';
import { Link } from '../router';

const STATE = {
  due: { color: 'am', label: 'vencido' },
  waiting: { color: 'gy', label: 'aguardando' },
  blocked: { color: 'rd', label: 'barrado' },
} as const;

export const FollowUpsPage = () => {
  const meta = useMeta().data!;
  const { data, error, reload } = useApi<FollowUpItem[]>('/api/followups');
  const { run, busy } = useAction();
  const [skipped, setSkipped] = useState<{ company: string; reason: string }[]>([]);
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;

  const today = brToday();
  const due = data.filter((item) => item.state === 'due');
  const byCampaign = [...new Set(due.map((item) => item.campaign))];
  const { maxFollowUps, intervalBusinessDays } = meta.sending.followUp;

  return (
    <>
      <div>
        <h1 className="t">Follow-ups</h1>
        <div className="sub">
          No máximo {maxFollowUps} follow-up{maxFollowUps === 1 ? '' : 's'}, {intervalBusinessDays.slice(0, maxFollowUps).join(' / ')} dias úteis depois do primeiro e-mail. Antes de cada um o sistema confere resposta, recusa,
          supressão e status da empresa.
        </div>
      </div>

      {maxFollowUps === 0 && <Banner color="gy">Follow-ups desligados em Configurações (máximo 0).</Banner>}

      {byCampaign.map((campaign) => {
        const items = due.filter((item) => item.campaign === campaign);
        const missingSteps = [...new Set(items.filter((item) => !item.hasTemplate).map((item) => item.step))].sort();
        const noTemplate = missingSteps.length > 0;
        return (
          <section className="cd" key={campaign}>
            <div className="cdh">
              <span className="cnt am">{items.length}</span>
              <h2 className="h">
                Vencidos em <span className="mono">{campaign}</span>
              </h2>
              <span className="sp" />
              <button
                className="bt p"
                disabled={busy || noTemplate}
                title={noTemplate ? `Aprove o template da etapa ${missingSteps.join(', ')} na campanha` : undefined}
                onClick={() =>
                  run(
                    async () => {
                      const result = await campaignApi.draftFollowUps(campaign);
                      setSkipped(result.skipped);
                      return result;
                    },
                    { success: 'Rascunhos de follow-up gerados. Revise antes de enviar.', reload: [reload] },
                  )
                }
              >
                Gerar {items.length} rascunho(s)
              </button>
            </div>
            {noTemplate && (
              <div className="cdb">
                <Banner color="am" icon="warn">
                  A campanha não tem template aprovado para a etapa {missingSteps.join(', ')}.{' '}
                  <Link to={`/campanhas/${encodeURIComponent(campaign)}?etapa=2`} style={{ textDecoration: 'underline' }}>
                    Escrever e aprovar
                  </Link>
                </Banner>
              </div>
            )}
            {items.map((item) => (
              <div className="li" key={`${item.company.id}-${item.step}`}>
                <Link className="nm" to={`/empresas/${item.company.domain}`} style={{ flex: '0 0 200px' }}>
                  {item.company.name}
                </Link>
                <span className="mt" style={{ flex: '1 1 260px' }}>
                  {item.contact.name} · enviado {item.firstSentAt ? shortDate(item.firstSentAt) : '?'} · “{item.previousSubject}”
                </span>
                <Chip color="am" dot={false}>
                  {relativeDay(item.dueAt, today).isToday ? 'vence hoje' : `venceu ${shortDate(item.dueAt)}`}
                </Chip>
              </div>
            ))}
          </section>
        );
      })}
      {skipped.length > 0 && (
        <Banner color="am" icon="warn">
          {skipped.map((item) => (
            <div key={item.company}>
              <span className="mono">{item.company}</span>: {item.reason}
            </div>
          ))}
        </Banner>
      )}
      {due.length === 0 && (
        <section className="cd">
          <div className="cdb mt">Nenhum follow-up vencido hoje.</div>
        </section>
      )}

      <section className="cd" data-tour="followups-board">
        <div className="cdh">
          <h2 className="h">Elegibilidade de todos</h2>
          <span className="mt">Inclui os que ainda vão vencer e os barrados, com o motivo</span>
        </div>
        <div className="tbw" style={{ border: 0, borderRadius: 0 }}>
          <table className="tb">
            <thead>
              <tr>
                {['Empresa', 'Contato', 'Campanha', 'Etapa', 'Envio anterior', 'Vence', 'Situação'].map((label) => (
                  <th key={label} scope="col">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.length === 0 && (
                <tr>
                  <td colSpan={7} className="mt">
                    Nenhuma mensagem enviada aguardando follow-up.
                  </td>
                </tr>
              )}
              {data.map((item) => (
                <tr key={`${item.company.id}-${item.step}`}>
                  <td>
                    <Link className="nm" to={`/empresas/${item.company.domain}`}>
                      {item.company.name}
                    </Link>
                  </td>
                  <td>{item.contact.name}</td>
                  <td className="mono mt">{item.campaign}</td>
                  <td className="mono">{item.step}</td>
                  <td>{item.firstSentAt ? shortDate(item.firstSentAt) : '—'}</td>
                  <td>{relativeDay(item.dueAt, today).label}</td>
                  <td>
                    <Chip color={STATE[item.state].color}>{STATE[item.state].label}</Chip> {item.reason && <span className="mt">{item.reason}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
};
