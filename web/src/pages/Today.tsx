import { type Today as TodayData, useApi } from '../api';
import { Banner, Chip, ErrorBox, Icon, Loading, StatusChip, useMeta } from '../components/ui';
import { brHourFraction, brTime, longToday, MONTH_NAMES, pct, relativeDay, shortDate, untilUtcMidnight, utcLabel } from '../format';
import { Link } from '../router';

const Section = ({ count, color, title, hint, children }: { count: number; color: string; title: string; hint?: string; children: React.ReactNode }) => (
  <section className="cd">
    <div className="cdh">
      <span className={`cnt ${color}`}>{count}</span>
      <h2 className="h">{title}</h2>
      {hint && <span className="mt">{hint}</span>}
    </div>
    {children}
  </section>
);

const Footer = ({ children }: { children: React.ReactNode }) => (
  <div className="li" style={{ background: 'var(--s2)', borderRadius: '0 0 8px 8px' }}>
    {children}
  </div>
);

const SendWindow = () => {
  const hour = brHourFraction();
  const start = 8;
  const span = 12;
  const position = Math.min(100, Math.max(0, ((hour - start) / span) * 100));
  const inside = hour >= 11 && hour < 15;
  const now = new Date().toISOString();
  return (
    <section className="cd" aria-label="Janela de envio" data-tour="today-window">
      <div className="cdh">
        <h2 className="h">Janela de envio sugerida</h2>
        <Chip color={inside ? 'gn' : 'am'} dot={false}>
          {inside ? 'dentro da janela' : 'fora da janela'}
        </Chip>
      </div>
      <div className="cdb" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ position: 'relative', height: 22, background: 'var(--gb)', borderRadius: 4 }} role="img" aria-label={`Janela entre 11h e 15h em Brasília; agora ${brTime(now)}`}>
          <div style={{ position: 'absolute', left: '25%', width: '33.3%', top: 0, bottom: 0, background: 'var(--nb)', borderRadius: 4 }} />
          <div style={{ position: 'absolute', left: `${position}%`, top: -3, bottom: -3, width: 2, background: 'var(--ac)' }} />
        </div>
        <div className="row mono" style={{ justifyContent: 'space-between', gap: 0 }}>
          <span>08h</span>
          <span>11h</span>
          <span>15h</span>
          <span>20h</span>
        </div>
        <div className="mt">
          Horário comercial de Reino Unido e EUA corresponde a <b>11h–15h em Brasília</b>. A linha marca agora ({brTime(now)}).
        </div>
      </div>
    </section>
  );
};

export const TodayPage = () => {
  const meta = useMeta().data;
  const { data, error, reload } = useApi<TodayData>('/api/today');
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data || !meta) return <Loading />;

  const now = new Date().toISOString();
  const draftsTotal = data.drafts.reduce((sum, item) => sum + item.evidenceBased + item.generic, 0);
  const remaining = Math.max(0, data.sending.dailyLimit - data.sending.sentToday);
  const batchMinutes = Math.max(1, Math.ceil(((data.approved.length - 1) * data.sending.minIntervalSeconds) / 60));
  const nothingPending =
    data.unknown.length + data.failed.length + data.drafts.length + data.approved.length + data.followUps.length + data.nextActions.length + data.ready.length === 0;
  const monthName = MONTH_NAMES[Number(data.month.from.slice(5, 7)) - 1];

  return (
    <>
      {meta.transport === 'outbox' && (
        <Banner color="bl">
          <b>Modo simulação (outbox):</b> nada sai da máquina. As mensagens ficam gravadas na caixa de saída local e nenhum e-mail é entregue.{' '}
          <Link to="/configuracoes" style={{ textDecoration: 'underline' }}>
            Configurar SMTP
          </Link>
        </Banner>
      )}
      <div className="row">
        <div>
          <h1 className="t">Hoje</h1>
          <div className="sub">
            {longToday()} · {brTime(now)} em Brasília{' '}
            <span className="mono" title="Todos os horários são gravados em UTC">
              ({now.slice(11, 16)} UTC)
            </span>
          </div>
        </div>
        <div className="sp" />
        {draftsTotal > 0 && (
          <Link className="bt p" to="/revisao">
            Revisar rascunhos <kbd style={{ background: 'transparent', color: 'inherit', borderColor: 'currentColor' }}>{draftsTotal}</kbd>
          </Link>
        )}
        <Link className="bt" to="/empresas/nova">
          Nova empresa
        </Link>
      </div>

      <div className="grid2">
        <div data-tour="today-queue" style={{ flex: '999 1 640px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {nothingPending && (
            <section className="cd">
              <div className="cdb" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <b>Nada pendente por aqui.</b>
                <span className="mt">
                  Para começar: cadastre empresas (ou importe um CSV), registre evidências com fonte, adicione um contato decisor e qualifique. As que ficarem prontas
                  aparecem aqui.
                </span>
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

          {data.unknown.length > 0 && (
            <Section count={data.unknown.length} color="am" title="Envios desconhecidos aguardando conciliação" hint="Bloqueiam o reenvio e a confiança nos números">
              {data.unknown.map((message) => (
                <div className="li" key={message.id}>
                  <div style={{ flex: '1 1 300px', minWidth: 0 }}>
                    <Link className="nm" to={`/empresas/${message.company.domain}`}>
                      {message.company.name}
                    </Link>{' '}
                    <span className="mono mt">{message.company.domain}</span>
                    <div className="mt">
                      Etapa {message.step} · para <span className="mono">{message.toEmail}</span>
                      {message.lastAttempt && (
                        <>
                          {' '}
                          · tentativa às <span title={utcLabel(message.lastAttempt.startedAt)}>{brTime(message.lastAttempt.startedAt)}</span>
                        </>
                      )}
                      {message.error && <>: {message.error}</>}
                    </div>
                  </div>
                  <StatusChip status="unknown" />
                  <Link className="bt sm" to="/conciliacao">
                    Conciliar
                  </Link>
                </div>
              ))}
            </Section>
          )}

          {data.failed.length > 0 && (
            <Section count={data.failed.length} color="rd" title="Envios com falha" hint="O provedor recusou; nada foi entregue">
              {data.failed.map((message) => (
                <div className="li" key={message.id}>
                  <div style={{ flex: '1 1 300px', minWidth: 0 }}>
                    <Link className="nm" to={`/empresas/${message.company.domain}`}>
                      {message.company.name}
                    </Link>{' '}
                    <span className="mono mt">{message.company.domain}</span>
                    <div className="mt">
                      Etapa {message.step} · <span className="mono">{message.error ?? 'sem detalhe do provedor'}</span>
                      {message.lastAttempt && (
                        <>
                          {' '}
                          · tentativa às <span title={utcLabel(message.lastAttempt.startedAt)}>{brTime(message.lastAttempt.startedAt)}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <StatusChip status="failed" />
                  <Link className="bt sm" to="/conciliacao">
                    Resolver
                  </Link>
                </div>
              ))}
            </Section>
          )}

          {data.drafts.length > 0 && (
            <Section count={draftsTotal} color="bl" title="Rascunhos aguardando revisão">
              {data.drafts.map((item) => (
                <div className="li" key={item.campaign.id}>
                  <div style={{ flex: '1 1 300px', minWidth: 0 }}>
                    <b className="mono">{item.campaign.name}</b>{' '}
                    <span style={{ marginLeft: 6 }}>
                      <StatusChip status={item.campaign.status} />
                    </span>
                    {item.evidenceBased + item.generic > 0 ? (
                      <div className="row" style={{ gap: 8, marginTop: 6 }}>
                        {item.evidenceBased > 0 && (
                          <Chip color="bl" dot={false}>
                            {item.evidenceBased} personalizada{item.evidenceBased > 1 ? 's' : ''} com evidência
                          </Chip>
                        )}
                        {item.generic > 0 && (
                          <Chip color="gy" dot={false}>
                            {item.generic} genérica{item.generic > 1 ? 's' : ''}
                          </Chip>
                        )}
                      </div>
                    ) : null}
                    {item.pendingTemplates.length > 0 && (
                      <div className="mt" style={{ marginTop: 4 }}>
                        Template da etapa {item.pendingTemplates.join(' e ')} tem versão nova <b>aguardando aprovação</b>.
                      </div>
                    )}
                  </div>
                  {item.evidenceBased + item.generic > 0 ? (
                    <Link className="bt p sm" to={`/revisao?campanha=${encodeURIComponent(item.campaign.name)}`}>
                      Revisar {item.evidenceBased + item.generic}
                    </Link>
                  ) : (
                    <Link className="bt sm" to={`/campanhas/${encodeURIComponent(item.campaign.name)}?etapa=2`}>
                      Aprovar template
                    </Link>
                  )}
                </div>
              ))}
            </Section>
          )}

          {data.approved.length > 0 && (
            <Section count={data.approved.length} color="gn" title="Mensagens aprovadas prontas para enviar" hint="Conteúdo travado por hash · nada sai sem a sua confirmação">
              {data.approved.map((message) => (
                <div className="li" key={message.id}>
                  <Link className="nm" to={`/empresas/${message.company.domain}`} style={{ flex: '0 0 190px' }}>
                    {message.company.name}
                  </Link>
                  <span className="mt" style={{ flex: '1 1 180px' }}>
                    {message.contact?.name}
                    {message.contact?.role ? ` · ${message.contact.role}` : ''} · <span className="mono">{message.campaign}</span>
                  </span>
                  <Chip color={message.personalization === 'evidence_based' ? 'gn' : 'gy'} dot={false}>
                    {message.personalization === 'evidence_based' ? 'personalizada' : 'genérica'}
                  </Chip>
                  <StatusChip status="approved" />
                </div>
              ))}
              <Footer>
                <div style={{ flex: '1 1 280px' }}>
                  <b className="mono">
                    {data.sending.sentToday}/{data.sending.dailyLimit}
                  </b>{' '}
                  enviadas hoje · restam <b>{remaining}</b>. Lote de {data.approved.length} mensage{data.approved.length > 1 ? 'ns' : 'm'} ≈ <b>{batchMinutes} min</b>{' '}
                  (intervalo de {data.sending.minIntervalSeconds} s).
                </div>
                <Link className="bt p" to={`/envio${new Set(data.approved.map((message) => message.campaign)).size === 1 ? `?campanha=${encodeURIComponent(data.approved[0]!.campaign)}` : ''}`}>
                  Simular envio…
                </Link>
              </Footer>
            </Section>
          )}

          {data.followUps.length > 0 && (
            <Section count={data.followUps.length} color="am" title="Follow-ups vencidos" hint={`${meta.sending.followUp.intervalBusinessDays.slice(0, meta.sending.followUp.maxFollowUps).join(' / ')} dias úteis após o 1º envio · no máximo ${meta.sending.followUp.maxFollowUps}`}>
              {data.followUps.map((item) => {
                const due = relativeDay(item.dueAt, data.today);
                return (
                  <div className="li" key={item.company.id}>
                    <Link className="nm" to={`/empresas/${item.company.domain}`} style={{ flex: '0 0 190px' }}>
                      {item.company.name}
                    </Link>
                    <span className="mt" style={{ flex: '1 1 220px' }}>
                      1º e-mail em {item.firstSentAt ? shortDate(item.firstSentAt) : '?'} · vence {shortDate(item.dueAt)}
                    </span>
                    <Chip color="am" dot={false}>
                      {due.isToday ? 'vence hoje' : 'vencido'}
                    </Chip>
                  </div>
                );
              })}
              <Footer>
                <span className="mt" style={{ flex: 1 }}>
                  Gerar rascunhos leva os follow-ups para a fila de revisão. Nada é enviado.
                </span>
                <Link className="bt sm" to="/followups">
                  Ver elegibilidade
                </Link>
              </Footer>
            </Section>
          )}

          {data.nextActions.length > 0 && (
            <Section count={data.nextActions.length} color="gy" title="Próximas ações vencidas ou de hoje">
              {data.nextActions.map((company) => {
                const due = relativeDay(company.nextActionAt!, data.today);
                return (
                  <div className="li" key={company.id}>
                    <Link className="nm" to={`/empresas/${company.domain}`} style={{ flex: '0 0 190px' }}>
                      {company.name}
                    </Link>
                    <StatusChip status={company.status} />
                    <span style={{ flex: '1 1 220px' }}>{company.nextActionNote ?? <span className="mt">sem nota</span>}</span>
                    <Chip color={due.overdue ? 'am' : 'gy'} dot={false} title={company.nextActionAt}>
                      {due.label}
                    </Chip>
                  </div>
                );
              })}
            </Section>
          )}

          {data.ready.length > 0 && (
            <Section count={data.ready.length} color="bl" title="Empresas prontas para abordagem" hint="Qualificadas, com contato apto e fora de campanha aberta">
              {data.ready.map(({ company, contact }) => (
                <div className="li" key={company.id}>
                  <span className="mono" style={{ flex: '0 0 28px' }}>
                    {company.country}
                  </span>
                  <Link className="nm" to={`/empresas/${company.domain}`} style={{ flex: '0 0 190px' }}>
                    {company.name}
                  </Link>
                  <span className="mt" style={{ flex: '1 1 200px' }}>
                    {contact.name}
                    {contact.role ? ` · ${contact.role}` : ''}
                  </span>
                  {company.qualification && (
                    <span className="mono">
                      {pct(company.qualification.score / company.qualification.maxScore)} · cob. {pct(company.qualification.coverage)}
                    </span>
                  )}
                </div>
              ))}
              {data.activeCampaigns.length === 0 && (
                <Footer>
                  <Icon name="info" />
                  <span style={{ flex: '1 1 300px' }}>Nenhuma campanha ativa para recebê-las. Crie uma campanha, aprove o template da etapa 0 e ative.</span>
                  <Link className="bt sm" to="/campanhas">
                    Ir para campanhas
                  </Link>
                </Footer>
              )}
            </Section>
          )}
        </div>

        <aside style={{ flex: '1 1 300px', minWidth: 280, maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section className="cd" aria-label="Limite diário" data-tour="today-limit">
            <div className="cdb" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="row" style={{ gap: 8 }}>
                <span className="mt">Envios hoje (UTC)</span>
                <span className="sp" />
                <span className="mono" style={{ fontSize: 18, fontWeight: 500 }}>
                  {data.sending.sentToday}/{data.sending.dailyLimit}
                </span>
              </div>
              <div className="bar" role="img" aria-label={`${data.sending.sentToday} de ${data.sending.dailyLimit} envios`}>
                <i style={{ width: `${Math.min(100, (data.sending.sentToday / data.sending.dailyLimit) * 100)}%` }} />
              </div>
              <div className="mt">
                Zera à meia-noite UTC, <b>21:00 em Brasília</b>. Faltam {untilUtcMidnight()}. Intervalo mínimo entre envios: {data.sending.minIntervalSeconds} s.
              </div>
            </div>
          </section>

          <section className="cd" aria-label="Resumo do mês" data-tour="today-month">
            <div className="cdh">
              <h2 className="h">Resumo de {monthName}</h2>
              <span className="sp" />
              <Link className="mt" to="/relatorio" style={{ textDecoration: 'underline' }}>
                Relatório
              </Link>
            </div>
            <div className="cdb" style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 12 }}>
              <div>
                <div className="mono" style={{ fontSize: 20 }}>
                  {data.month.reached}
                </div>
                <div className="mt">Abordados</div>
              </div>
              <div>
                <div className="mono" style={{ fontSize: 20 }}>
                  {data.month.responded}
                </div>
                <div className="mt">Respostas humanas</div>
              </div>
              <div>
                <div className="mono" style={{ fontSize: 20 }}>
                  {data.month.interested}
                </div>
                <div className="mt">Interessados</div>
              </div>
              <div>
                <div className="mono" style={{ fontSize: 20 }}>
                  {data.month.opportunities}
                </div>
                <div className="mt" title="Status atual, não só do mês">
                  Oportunidades (agora)
                </div>
              </div>
            </div>
            {data.month.warnings.length > 0 && (
              <div className="cdb" style={{ borderTop: '1px solid var(--ln)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.month.warnings.map((warning) => (
                  <div className="bn am" key={warning}>
                    <span>{warning}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <SendWindow />

          <section className="cd" aria-label="Em breve" style={{ borderStyle: 'dashed' }}>
            <div className="cdb">
              <div className="row" style={{ gap: 8 }}>
                <b>Leitura de respostas por IMAP</b>
                <Chip color="gy" dot={false}>
                  em breve
                </Chip>
              </div>
              <div className="mt" style={{ marginTop: 4 }}>
                Casará respostas pelo Message-ID e sugerirá a categoria para você confirmar. Nunca classificará como oportunidade sozinha.
              </div>
            </div>
          </section>
        </aside>
      </div>
    </>
  );
};
