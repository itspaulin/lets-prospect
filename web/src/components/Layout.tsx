import { Fragment, type ReactNode, useEffect, useMemo, useState } from 'react';
import { type CompanyRow, useApi } from '../api';
import { brTime, utcLabel } from '../format';
import { Link, navigate, useLocation } from '../router';
import { nextSection, PAGE_TOURS, pageTourFor } from './pageTours';
import { isTourDone, MAIN_TOUR, MAIN_TOUR_KEY, markTourDone, Tour } from './Tour';
import { Dialog, Icon, type ICONS, statusLabel, useMeta } from './ui';

type NavItem = { to: string; label: string; icon: keyof typeof ICONS; badge?: number };
type NavGroup = { title?: string; items: NavItem[] };

// Which channel a screen belongs to, so the top bar can say it on every page.
const EMAIL_PATHS = ['/empresas', '/descoberta', '/prospeccao', '/campanhas', '/revisao', '/envio', '/conciliacao', '/followups', '/respostas', '/relatorio'];
const WHATSAPP_PATHS = ['/leads', '/whatsapp'];
const inside = (path: string, bases: string[]) => bases.some((base) => path === base || path.startsWith(`${base}/`));
const channelOf = (path: string): 'email' | 'whatsapp' | null => (inside(path, EMAIL_PATHS) ? 'email' : inside(path, WHATSAPP_PATHS) ? 'whatsapp' : null);

const useTheme = () => {
  const initial = () => {
    try {
      const saved = localStorage.getItem('theme');
      if (saved === 'dark' || saved === 'light') return saved === 'dark';
    } catch {
      /* storage blocked: follow the system */
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  };
  const [dark, setDark] = useState(initial);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('theme', dark ? 'dark' : 'light');
    } catch {
      /* ignore */
    }
  }, [dark]);
  return { dark, toggle: () => setDark((value) => !value) };
};

const useClock = () => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
};

const CommandPalette = ({ onClose }: { onClose: () => void }) => {
  const companies = useApi<CompanyRow[]>('/api/companies');
  const campaigns = useApi<{ id: string; name: string; status: string }[]>('/api/campaigns');
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const items = useMemo(() => {
    const actions = [
      { label: 'Nova empresa', hint: 'e-mail · ação', to: '/empresas/nova' },
      { label: 'Importar CSV', hint: 'e-mail · ação', to: '/empresas/nova?tab=csv' },
      { label: 'Possíveis duplicadas', hint: 'e-mail · ação', to: '/empresas/duplicadas' },
      { label: 'Prospectar por região', hint: 'e-mail · ação', to: '/descoberta' },
      { label: 'Registrar resposta', hint: 'e-mail · ação', to: '/respostas' },
      { label: 'Revisar rascunhos', hint: 'e-mail · ação', to: '/revisao' },
      { label: 'Enviar campanha', hint: 'e-mail · ação', to: '/envio' },
      { label: 'Conciliação e falhas', hint: 'e-mail · tela', to: '/conciliacao' },
      { label: 'Rotina de WhatsApp', hint: 'WhatsApp · ação', to: '/whatsapp' },
      { label: 'Buscar leads por telefone', hint: 'WhatsApp · ação', to: '/leads' },
      ...['Hoje:geral:/', 'Empresas:e-mail:/empresas', 'Descoberta:e-mail:/descoberta', 'Leads:WhatsApp:/leads', 'Fila de envio do WhatsApp:WhatsApp:/whatsapp', 'Campanhas:e-mail:/campanhas', 'Follow-ups:e-mail:/followups', 'Relatório:e-mail:/relatorio', 'Supressões:geral:/supressoes', 'Configurações:geral:/configuracoes'].map((entry) => {
        const [label, channel, to] = entry.split(':') as [string, string, string];
        return { label, hint: `${channel} · tela`, to };
      }),
    ];
    const needle = query.trim().toLowerCase();
    const found = (companies.data ?? [])
      .filter((company) => !needle || company.name.toLowerCase().includes(needle) || company.domain.includes(needle))
      .slice(0, 8)
      .map((company) => ({ label: company.name, hint: company.domain, to: `/empresas/${company.domain}` }));
    const campaignItems = (campaigns.data ?? [])
      .filter((campaign) => !needle || campaign.name.toLowerCase().includes(needle))
      .slice(0, 5)
      .map((campaign) => ({ label: campaign.name, hint: `campanha · ${statusLabel(campaign.status).toLowerCase()}`, to: `/campanhas/${encodeURIComponent(campaign.name)}` }));
    return [...actions.filter((action) => !needle || action.label.toLowerCase().includes(needle)), ...campaignItems, ...found];
  }, [companies.data, campaigns.data, query]);

  const go = (to: string) => {
    onClose();
    navigate(to);
  };

  return (
    <Dialog label="Buscar ou executar ação" onClose={onClose} width={560}>
      <input
        className="in"
        autoFocus
        placeholder="Empresa, domínio ou ação…"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setIndex(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') (event.preventDefault(), setIndex((value) => Math.min(value + 1, items.length - 1)));
          if (event.key === 'ArrowUp') (event.preventDefault(), setIndex((value) => Math.max(value - 1, 0)));
          if (event.key === 'Enter' && items[index]) go(items[index].to);
        }}
      />
      <div className="cd" style={{ maxHeight: 360, overflowY: 'auto' }}>
        {items.length === 0 && <div className="li mt">Nada encontrado.</div>}
        {items.map((item, position) => (
          <button
            key={item.to + item.label}
            className="li"
            style={{ width: '100%', border: 0, textAlign: 'left', cursor: 'pointer', background: position === index ? 'var(--acs)' : 'transparent' }}
            onMouseEnter={() => setIndex(position)}
            onClick={() => go(item.to)}
          >
            <span className="nm" style={{ flex: 1 }}>
              {item.label}
            </span>
            <span className="mono mt">{item.hint}</span>
          </button>
        ))}
      </div>
      <div className="mt">
        <kbd>↑</kbd> <kbd>↓</kbd> navegar · <kbd>Enter</kbd> abrir · <kbd>Esc</kbd> fechar
      </div>
    </Dialog>
  );
};

export const Layout = ({ children }: { children: ReactNode }) => {
  const meta = useMeta();
  const { path } = useLocation();
  const theme = useTheme();
  const now = useClock();
  const [palette, setPalette] = useState(false);
  const [touring, setTouring] = useState(() => !isTourDone(MAIN_TOUR_KEY));
  const pageTour = pageTourFor(path);
  const [pageTouring, setPageTouring] = useState<string | null>(null);
  // Right after the general tour, the screen it ended on does not open its own tour on top.
  const [skipAutoOn, setSkipAutoOn] = useState<string | null>(null);
  // Set by "Ir para a próxima seção": opens that section's tour once its screen has loaded, even if seen before.
  const [chainTo, setChainTo] = useState<string | null>(null);
  const cancelAllTours = () => {
    [MAIN_TOUR_KEY, ...PAGE_TOURS.map((tour) => tour.key)].forEach(markTourDone);
    setTouring(false);
    setPageTouring(null);
    setChainTo(null);
  };

  // First visit to each screen (after the general tour) opens that screen's tour once the data has loaded.
  useEffect(() => {
    if (touring || pageTouring || !pageTour) return;
    const chained = chainTo === pageTour.key;
    if (!chained && (isTourDone(pageTour.key) || skipAutoOn === path)) return;
    const id = window.setTimeout(() => {
      setChainTo(null);
      setPageTouring(pageTour.key);
    }, 700);
    return () => window.clearTimeout(id);
  }, [path, touring, pageTouring, pageTour, skipAutoOn, chainTo]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPalette((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const badges = meta.data?.badges;
  const groups: NavGroup[] = [
    { items: [{ to: '/', label: 'Hoje', icon: 'home' }] },
    {
      title: 'E-mail',
      items: [
        { to: '/empresas', label: 'Empresas', icon: 'company' },
        { to: '/descoberta', label: 'Descoberta', icon: 'prospect' },
        { to: '/campanhas', label: 'Campanhas', icon: 'campaign' },
        { to: '/revisao', label: 'Revisão', icon: 'review', badge: badges?.drafts },
        { to: '/followups', label: 'Follow-ups', icon: 'followup', badge: badges?.followUps },
        { to: '/respostas', label: 'Respostas', icon: 'reply' },
        { to: '/relatorio', label: 'Relatório', icon: 'report' },
      ],
    },
    {
      title: 'WhatsApp',
      items: [
        { to: '/leads', label: 'Leads', icon: 'contact' },
        { to: '/whatsapp', label: 'Fila de envio', icon: 'message', badge: badges?.waDrafts },
      ],
    },
    {
      title: 'Geral',
      items: [
        { to: '/supressoes', label: 'Supressões', icon: 'suppress' },
        { to: '/configuracoes', label: 'Configurações', icon: 'settings' },
      ],
    },
  ];
  const channel = channelOf(path);
  const active = (to: string) => (to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`));
  const iso = now.toISOString();

  return (
    <div className={`app${theme.dark ? ' dark' : ''}`}>
      <nav className="sb" aria-label="Navegação principal">
        <div className="br">
          <i />
          <span>Prospecção</span>
        </div>
        {groups.map((group, index) => (
          <Fragment key={group.title ?? index}>
            {group.title && (
              <div className="ng">
                {group.title}
              </div>
            )}
            {group.items.map((item) => (
              <Link key={item.to} to={item.to} className={`ni${active(item.to) ? ' on' : ''}`} data-tour={item.to}>
                <Icon name={item.icon} />
                <span>{item.label}</span>
                {!!item.badge && <b>{item.badge}</b>}
              </Link>
            ))}
          </Fragment>
        ))}
        <div className="sbf hide-sm">
          {meta.data &&
            (meta.data.transport === 'smtp' ? (
              <span className="ch am nd" title="Mensagens aprovadas saem de verdade" data-tour="transport">
                Envio real (SMTP)
              </span>
            ) : (
              <span className="ch bl nd" title="Nada sai da máquina" data-tour="transport">
                Simulação (outbox)
              </span>
            ))}
          {meta.data &&
            (meta.data.whatsapp.delivers ? (
              <span className="ch am nd" title="Mensagens de WhatsApp saem de verdade">
                WhatsApp real
              </span>
            ) : (
              <span className="ch bl nd" title="Nada de WhatsApp sai da máquina">
                WhatsApp simulado
              </span>
            ))}
          {!touring && (
            <button className="tour-link" onClick={() => setTouring(true)}>
              Ver tour
            </button>
          )}
          <span className="mt">Banco local · SQLite</span>
        </div>
      </nav>
      <div className="mn">
        <header className="top">
          <button className="srch" data-tour="search" onClick={() => setPalette(true)} aria-label="Abrir busca e comandos" style={{ cursor: 'pointer' }}>
            <Icon name="search" />
            <span>Buscar ou executar ação…</span>
            <kbd style={{ marginLeft: 'auto' }}>Ctrl K</kbd>
          </button>
          {channel && (
            <span className={`ch ${channel === 'email' ? 'bl' : 'gn'} nd`} title={channel === 'email' ? 'Esta tela é do canal de e-mail' : 'Esta tela é do canal de WhatsApp'}>
              {channel === 'email' ? 'Canal: e-mail' : 'Canal: WhatsApp'}
            </span>
          )}
          <div className="sp" />
          <span className="mt" title={utcLabel(iso)}>
            {brTime(iso)} (Brasília)
          </span>
          {pageTour && (
            <button className="bt sm" onClick={() => setPageTouring(pageTour.key)} disabled={touring || !!pageTouring} title={`Tour da tela ${pageTour.title}`}>
              ? Tour desta tela
            </button>
          )}
          <button className="bt sm" onClick={theme.toggle}>
            {theme.dark ? 'Tema claro' : 'Tema escuro'}
          </button>
        </header>
        <main className="pg">
          {meta.error && !meta.data ? (
            <div className="bn rd">
              <div>
                <b>API fora do ar.</b> Rode <span className="mono">npm run api</span> e recarregue. ({meta.error})
              </div>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
      {palette && <CommandPalette onClose={() => setPalette(false)} />}
      {touring && meta.data && <Tour steps={MAIN_TOUR} storageKey={MAIN_TOUR_KEY} onClose={() => (setTouring(false), setSkipAutoOn(window.location.pathname))} onCancel={cancelAllTours} />}
      {!touring && pageTouring && pageTour?.key === pageTouring && (
        <Tour
          key={pageTouring}
          steps={pageTour.steps}
          storageKey={pageTour.key}
          onClose={() => setPageTouring(null)}
          onCancel={cancelAllTours}
          next={(() => {
            const following = nextSection(pageTour);
            return following
              ? {
                  label: following.tour.title,
                  go: () => {
                    setPageTouring(null);
                    setChainTo(following.tour.key);
                    navigate(following.path);
                  },
                }
              : undefined;
          })()}
        />
      )}
    </div>
  );
};
