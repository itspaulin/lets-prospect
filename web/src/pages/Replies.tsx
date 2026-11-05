import { useMemo, useState } from 'react';
import { api, type ReplyContact, type ReplyItem, useApi } from '../api';
import { Banner, Chip, Dialog, ErrorBox, Loading, StatusChip, useAction, useMeta } from '../components/ui';
import { brToday, shortDate } from '../format';
import { Link } from '../router';

const LABEL: Record<string, string> = {
  interested_to_talk: 'Interesse em conversar',
  future_collaboration: 'Colaboração futura',
  more_info: 'Pediu mais informações',
  cv_or_portfolio: 'Pediu currículo ou portfólio',
  no_need_now: 'Sem necessidade agora',
  declined: 'Recusou',
  referral: 'Encaminhou para outro contato',
  auto_reply: 'Resposta automática',
  invalid_address: 'Endereço inválido',
  unsubscribe: 'Pediu para parar',
  inconclusive: 'Inconclusiva',
};

const COLOR = (effect: { interest: boolean; suppressContact: boolean; companyStatus?: string; countsAsResponse: boolean }) =>
  effect.suppressContact ? 'dr' : effect.companyStatus ? 'rd' : effect.interest ? 'gn' : effect.countsAsResponse ? 'vi' : 'gy';

type Effect = { countsAsResponse: boolean; interest: boolean; stopsSequence: boolean; suppressContact: boolean; invalidContact: boolean; companyStatus?: string };

const describe = (effect: Effect): string[] => {
  const lines: string[] = [];
  lines.push(effect.countsAsResponse ? 'Conta como resposta humana nas taxas.' : 'Não conta como resposta humana.');
  if (effect.stopsSequence) lines.push('Cancela rascunhos e mensagens aprovadas pendentes da empresa (para a sequência).');
  else lines.push('Não para os follow-ups.');
  if (effect.invalidContact) lines.push('Marca o e-mail do contato como inválido.');
  if (effect.suppressContact) lines.push('Suprime o endereço para sempre: nunca mais recebe mensagens.');
  if (effect.companyStatus) lines.push(`Move a empresa para ${effect.companyStatus}.`);
  else if (effect.countsAsResponse) lines.push('Move a empresa de contacted para replied e cria a próxima ação “responder” para hoje.');
  if (effect.interest) lines.push('Conta como interesse. Mover para interested continua sendo manual.');
  return lines;
};

const RecordDialog = ({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) => {
  const meta = useMeta().data!;
  const contacts = useApi<ReplyContact[]>('/api/replies/contacts');
  const { run, busy } = useAction();
  const [search, setSearch] = useState('');
  const [contact, setContact] = useState<ReplyContact | null>(null);
  const [category, setCategory] = useState('');
  const [summary, setSummary] = useState('');
  const [date, setDate] = useState(brToday());
  const [confirmText, setConfirmText] = useState('');
  const effects = meta.replyEffects as Record<string, Effect>;
  const effect = category ? effects[category] : undefined;

  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (contacts.data ?? []).filter((item) => !needle || item.email.includes(needle) || item.name.toLowerCase().includes(needle) || item.company.name.toLowerCase().includes(needle)).slice(0, 8);
  }, [contacts.data, search]);

  const needsConfirm = category === 'unsubscribe';
  const submit = async () => {
    const saved = await run(() => api.post('/api/replies', { contact: contact!.id, category, summary: summary.trim() || undefined, receivedAt: date }), {
      success: 'Resposta registrada e efeitos aplicados.',
      reload: [onDone],
    });
    if (saved) onClose();
  };

  return (
    <Dialog label="Registrar resposta" onClose={onClose} width={620}>
      <h2 className="h" style={{ fontSize: 17 }}>
        Registrar resposta
      </h2>
      {!contact ? (
        <>
          <label className="lb">
            De quem? (nome, e-mail ou empresa)
            <input className="in" value={search} onChange={(event) => setSearch(event.target.value)} autoFocus />
          </label>
          <div className="cd" style={{ maxHeight: 260, overflowY: 'auto' }}>
            {matches.length === 0 && <div className="li mt">Nenhum contato com e-mail encontrado.</div>}
            {matches.map((item) => (
              <button key={item.id} className="li" style={{ width: '100%', border: 0, textAlign: 'left', background: 'transparent', cursor: 'pointer' }} onClick={() => setContact(item)}>
                <b>{item.name}</b>
                <span className="mono mt">{item.email}</span>
                <span className="mt">{item.company.name}</span>
                <span className="sp" />
                <span className="mt">{item.lastSentAt ? `último envio ${shortDate(item.lastSentAt)}` : 'sem envio'}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="row">
          <b>{contact.name}</b>
          <span className="mono mt">{contact.email}</span>
          <StatusChip status={contact.company.status} />
          <span className="sp" />
          <button className="bt sm gh" onClick={() => setContact(null)}>
            trocar
          </button>
        </div>
      )}
      {contact && (
        <>
          <label className="lb">
            Categoria
            <select className="in" value={category} onChange={(event) => (setCategory(event.target.value), setConfirmText(''))}>
              <option value="">Escolha…</option>
              {meta.replyCategories.map((item) => (
                <option key={item} value={item}>
                  {LABEL[item]} ({item})
                </option>
              ))}
            </select>
          </label>
          {effect && (
            <Banner color={COLOR(effect) === 'dr' ? 'dr' : COLOR(effect) === 'rd' ? 'rd' : 'bl'} icon={effect.suppressContact ? 'warn' : 'info'}>
              <b>Ao salvar:</b>
              {describe(effect).map((line) => (
                <div key={line}>· {line}</div>
              ))}
            </Banner>
          )}
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <label className="lb" style={{ flex: 1 }}>
              Resumo
              <input className="in" value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Ex.: quer conversar na quinta às 14h (UK)" />
            </label>
            <label className="lb">
              Recebida em
              <input className="in" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
          </div>
          {needsConfirm && (
            <label className="lb">
              Digite PARAR para confirmar a supressão permanente
              <input className="in mono" value={confirmText} onChange={(event) => setConfirmText(event.target.value)} />
            </label>
          )}
        </>
      )}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="bt" onClick={onClose}>
          Cancelar
        </button>
        <button className="bt p" disabled={busy || !contact || !category || (needsConfirm && confirmText !== 'PARAR')} onClick={submit}>
          Registrar
        </button>
      </div>
    </Dialog>
  );
};

export const RepliesPage = () => {
  const meta = useMeta().data!;
  const { data, error, reload } = useApi<ReplyItem[]>('/api/replies');
  const { run, busy } = useAction();
  const [recording, setRecording] = useState(false);
  const [filter, setFilter] = useState('');
  const [campaign, setCampaign] = useState('');
  const [correcting, setCorrecting] = useState<{ item: ReplyItem; category: string } | null>(null);

  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const campaigns = [...new Set(data.map((item) => item.campaign).filter(Boolean))] as string[];
  const rows = data.filter((item) => (!filter || item.category === filter) && (!campaign || item.campaign === campaign));
  const effects = meta.replyEffects as Record<string, Effect>;

  return (
    <>
      <div className="row">
        <div>
          <h1 className="t">Respostas</h1>
          <div className="sub">Registro manual com classificação revisável. Nenhuma resposta vira oportunidade sem você mover a empresa.</div>
        </div>
        <span className="sp" />
        <button className="bt p" onClick={() => setRecording(true)} data-tour="replies-record">
          Registrar resposta
        </button>
      </div>

      <div className="row" style={{ gap: 6 }} data-tour="replies-filters">
        <span className="mt">Categoria</span>
        <button className={`bt sm${filter === '' ? ' on' : ''}`} onClick={() => setFilter('')}>
          Todas · {data.length}
        </button>
        {meta.replyCategories
          .filter((item) => data.some((reply) => reply.category === item))
          .map((item) => (
            <button key={item} className={`bt sm${filter === item ? ' on' : ''}`} onClick={() => setFilter(item)}>
              {LABEL[item]} · {data.filter((reply) => reply.category === item).length}
            </button>
          ))}
        {campaigns.length > 0 && (
          <select className="in" value={campaign} onChange={(event) => setCampaign(event.target.value)} style={{ marginLeft: 'auto' }}>
            <option value="">Todas as campanhas</option>
            {campaigns.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        )}
      </div>

      <div className="tbw" data-tour="replies-list">
        <table className="tb">
          <thead>
            <tr>
              {['Recebida', 'Empresa', 'Contato', 'Categoria', 'Resumo', 'Campanha', ''].map((label, index) => (
                <th key={index} scope="col">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="mt">
                  Nenhuma resposta registrada{filter ? ' nesta categoria' : ''}.
                </td>
              </tr>
            )}
            {rows.map((item) => (
              <tr key={item.id}>
                <td>{shortDate(item.receivedAt, true)}</td>
                <td>
                  <Link className="nm" to={`/empresas/${item.company.domain}`}>
                    {item.company.name}
                  </Link>{' '}
                  <StatusChip status={item.company.status} />
                </td>
                <td>
                  {item.contact?.name ?? <span className="mt">dados apagados</span>}
                  {item.contact?.email && <div className="mono mt">{item.contact.email}</div>}
                </td>
                <td>
                  <Chip color={COLOR(item.effect)} title={item.category}>
                    {LABEL[item.category]}
                  </Chip>
                </td>
                <td>{item.summary ?? <span className="mt">—</span>}</td>
                <td className="mono mt">{item.campaign ?? '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="bt sm" onClick={() => setCorrecting({ item, category: item.category })}>
                    Corrigir
                  </button>
                  {item.effect.interest && item.company.status === 'replied' && (
                    <Link className="bt sm" to={`/empresas/${item.company.domain}`} style={{ marginLeft: 4 }}>
                      Mover p/ interested…
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="cd" style={{ borderStyle: 'dashed' }}>
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

      {recording && <RecordDialog onClose={() => setRecording(false)} onDone={reload} />}

      {correcting && (
        <Dialog label="Corrigir classificação" onClose={() => setCorrecting(null)}>
          <h2 className="h" style={{ fontSize: 17 }}>
            Corrigir classificação
          </h2>
          <div className="mt">
            A correção vira um evento no histórico. Efeitos já aplicados (supressão, cancelamentos) não são desfeitos; os da nova categoria são aplicados.
          </div>
          <select className="in" value={correcting.category} onChange={(event) => setCorrecting({ ...correcting, category: event.target.value })}>
            {meta.replyCategories.map((item) => (
              <option key={item} value={item}>
                {LABEL[item]} ({item})
              </option>
            ))}
          </select>
          {correcting.category !== correcting.item.category && (
            <Banner color="bl">
              {describe(effects[correcting.category]!).map((line) => (
                <div key={line}>· {line}</div>
              ))}
            </Banner>
          )}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="bt" onClick={() => setCorrecting(null)}>
              Cancelar
            </button>
            <button
              className="bt p"
              disabled={busy || correcting.category === correcting.item.category}
              onClick={async () => {
                await run(() => api.post(`/api/replies/${correcting.item.id}/correct`, { category: correcting.category }), { success: 'Classificação corrigida.', reload: [reload] });
                setCorrecting(null);
              }}
            >
              Salvar correção
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
};
