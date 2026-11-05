import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { CompanyStatus, Meta, Priority, Resource } from '../api';
import { canonicalKey } from '../../../src/core/rules/technology.js';
import { pct } from '../format';

export const ICONS = {
  home: 'M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z',
  company: 'M4 21V5l8-2v18M12 21h8V9l-8 2M8 8h1M8 12h1M8 16h1M16 13h1M16 17h1',
  campaign: 'M3 11v3l4 1 8 4V6L7 10zM18 9a4 4 0 0 1 0 6',
  review: 'M8 12.5l3 3 5-6',
  followup: 'M12 7v5l3 2',
  reply: 'M4 5h16v11H9l-5 4z',
  report: 'M5 20V10M12 20V4M19 20v-7',
  suppress: 'M5.6 5.6l12.8 12.8',
  settings: 'M4 7h10M18 7h2M4 17h2M10 17h10',
  search: 'M20 20l-4-4',
  info: 'M12 11v5M12 8h.01',
  warn: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  alert: 'M12 8v5M12 16h.01',
  status: 'M4 8h13l-3-3M20 16H7l3 3',
  contact: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  evidence: 'M7 3h7l5 5v13H7zM14 3v5h5',
  message: 'M3 6h18v12H3zM3 7l9 6 9-6',
  note: 'M4 20l4-1 11-11-3-3L5 16z',
  prospect: 'M12 1v5M12 18v5M1 12h5M18 12h5M12 12h.01',
} as const;

const CIRCLED = new Set(['review', 'followup', 'suppress', 'info', 'alert', 'prospect']);

export const Icon = ({ name, style }: { name: keyof typeof ICONS; style?: React.CSSProperties }) => (
  <svg className="ic" viewBox="0 0 24 24" aria-hidden="true" style={style}>
    {CIRCLED.has(name) && <circle cx="12" cy="12" r="9" />}
    {name === 'search' && <circle cx="11" cy="11" r="7" />}
    {name === 'settings' && (
      <>
        <circle cx="16" cy="7" r="2" />
        <circle cx="8" cy="17" r="2" />
      </>
    )}
    <path d={ICONS[name]} />
  </svg>
);

export const STATUS_COLOR: Record<string, string> = {
  identified: 'gy',
  qualified: 'bl',
  contacted: 'bl',
  replied: 'vi',
  interested: 'vi',
  opportunity: 'gn',
  converted: 'gn',
  disqualified: 'rd',
  not_interested: 'rd',
  inactive: 'gy',
  do_not_contact: 'dr',
  draft: 'gy',
  approved: 'bl',
  sending: 'am',
  sent: 'gn',
  failed: 'rd',
  unknown: 'am',
  cancelled: 'gy',
  active: 'gn',
  paused: 'am',
  closed: 'gy',
  met: 'gn',
  partial: 'am',
  not_met: 'rd',
  verified: 'gn',
  unverified: 'gy',
  invalid: 'rd',
  hypothesis: 'am',
};

export const KANBAN_ORDER: CompanyStatus[] = [
  'identified',
  'qualified',
  'contacted',
  'replied',
  'interested',
  'opportunity',
  'converted',
  'disqualified',
  'not_interested',
  'inactive',
  'do_not_contact',
];

export const PRIORITY_LABEL: Record<Priority, string> = { high: 'Alta', medium: 'Média', low: 'Baixa' };

export const Chip = ({ color = 'gy', dot = true, children, title }: { color?: string; dot?: boolean; children: ReactNode; title?: string }) => (
  <span className={`ch ${color}${dot ? '' : ' nd'}`} title={title}>
    {children}
  </span>
);

// Labels shown on screen; the code stays in the tooltip because docs and the CLI use it.
export const STATUS_LABEL: Record<string, string> = {
  identified: 'Identificada',
  qualified: 'Qualificada',
  contacted: 'Contatada',
  replied: 'Respondeu',
  interested: 'Interessada',
  opportunity: 'Oportunidade',
  converted: 'Convertida',
  disqualified: 'Desqualificada',
  not_interested: 'Sem interesse',
  inactive: 'Inativa',
  do_not_contact: 'Não contatar',
  draft: 'Rascunho',
  approved: 'Aprovada',
  sending: 'Enviando',
  sent: 'Enviada',
  failed: 'Falhou',
  unknown: 'Sem confirmação',
  cancelled: 'Cancelada',
  active: 'Ativa',
  paused: 'Pausada',
  closed: 'Encerrada',
};

export const statusLabel = (status: string) => STATUS_LABEL[status] ?? status;

export const StatusChip = ({ status, title }: { status: string; title?: string }) => (
  <Chip color={STATUS_COLOR[status] ?? 'gy'} title={title ?? status}>
    {statusLabel(status)}
  </Chip>
);

const FLAGS = new Set(['gb', 'us', 'ca', 'ie', 'au']);
export const Flag = ({ country }: { country: string }) => {
  const code = country.toLowerCase();
  return <i className={`fl ${FLAGS.has(code) ? code : 'xx'}`} />;
};

// Mine first and highlighted; the rest of the company's stack folds into "+N outras" (click to show), since
// it only matters as the denominator of the stack score.
export const TechTags = ({ technologies, stack }: { technologies: string[]; stack: string[] }) => {
  const [open, setOpen] = useState(false);
  const mine = new Set(stack.map(canonicalKey));
  const matching = technologies.filter((tech) => mine.has(canonicalKey(tech)));
  const others = technologies.filter((tech) => !mine.has(canonicalKey(tech)));
  return (
    <>
      {matching.map((tech) => (
        <span key={tech} className="tg mine">
          {tech}
        </span>
      ))}
      {others.length > 0 &&
        (open ? (
          others.map((tech) => (
            <span key={tech} className="tg">
              {tech}
            </span>
          ))
        ) : (
          <button className="tg" style={{ cursor: 'pointer', border: 0 }} title={others.join(', ')} onClick={() => setOpen(true)}>
            +{others.length} outra{others.length === 1 ? '' : 's'}
          </button>
        ))}
    </>
  );
};

export const ScoreInline = ({ score, coverage }: { score?: number; coverage?: number }) =>
  score === undefined ? (
    <span className="mt">sem avaliação</span>
  ) : (
    <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
      <div className="bar" style={{ width: 70, flex: 'none' }} title={`Pontuação ${pct(score)}, cobertura ${pct(coverage ?? 0)}`}>
        <i style={{ width: pct(score) }} />
      </div>
      <span className="mono">{pct(score)}</span>
      <span className="mt">cob. {pct(coverage ?? 0)}</span>
    </div>
  );

export const Banner = ({ color = 'bl', icon = 'info', children }: { color?: string; icon?: keyof typeof ICONS | null; children: ReactNode }) => (
  <div className={`bn ${color}`}>
    {icon && <Icon name={icon} style={{ marginTop: 2 }} />}
    <div>{children}</div>
  </div>
);

export const Loading = () => <div className="ld">Carregando…</div>;

export const ErrorBox = ({ error, onRetry }: { error: string; onRetry?: () => void }) => (
  <Banner color="rd" icon="alert">
    <span className="err">{error}</span>
    {onRetry && (
      <>
        {' '}
        <button className="lnk" onClick={onRetry}>
          Tentar de novo
        </button>
      </>
    )}
  </Banner>
);

export const Dialog = ({ label, onClose, children, width }: { label: string; onClose: () => void; children: ReactNode; width?: number }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input,textarea,select,button')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="ov" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="md" role="dialog" aria-modal="true" aria-label={label} ref={ref} style={width ? { width: `min(${width}px,92%)` } : undefined}>
        {children}
      </div>
    </div>
  );
};

type Toast = { text: string; color: string };
const ToastContext = createContext<(text: string, color?: string) => void>(() => undefined);

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((text: string, color = 'gn') => {
    window.clearTimeout(timer.current);
    setToast({ text, color });
    timer.current = window.setTimeout(() => setToast(null), color === 'rd' ? 7000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <div className={`bn ${toast.color} toast`} role="status" onClick={() => setToast(null)}>
          {toast.text}
        </div>
      )}
    </ToastContext.Provider>
  );
};

export const useToast = () => useContext(ToastContext);

export const MetaContext = createContext<Resource<Meta> | null>(null);
export const useMeta = () => useContext(MetaContext)!;

// Runs an action, shows its error as a toast and refreshes whatever the screen depends on.
export const useAction = () => {
  const toast = useToast();
  const meta = useMeta();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(work: () => Promise<T>, options: { success?: string; reload?: Array<() => Promise<void>> } = {}): Promise<T | undefined> => {
      setBusy(true);
      try {
        const result = await work();
        if (options.success) toast(options.success);
        await Promise.all([...(options.reload ?? []).map((reload) => reload()), meta.reload()]);
        return result;
      } catch (error) {
        toast((error as Error).message, 'rd');
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast, meta],
  );
  return { run, busy };
};

export const RateCard = ({ rate }: { rate: { name: string; numerator: number; denominator: number; value: number | null; definition: string } }) => (
  <div title={rate.definition} style={{ minWidth: 0 }}>
    <div className="mono" style={{ fontSize: 20 }}>
      {rate.value === null ? '—' : `${rate.value}%`}
    </div>
    <div className="mt">
      {rate.name} · {rate.numerator}/{rate.denominator}
    </div>
    <div className="mt" style={{ fontSize: 12.5 }}>
      {rate.value === null ? 'sem denominador: nada a medir ainda' : rate.definition}
    </div>
  </div>
);

export const MailPreview = ({ from, to, subject, body }: { from: { name: string; email: string }; to: string; subject: string; body: string }) => (
  <div className="mail">
    <div className="hd">
      De: {from.name || '(SENDER_NAME vazio)'} &lt;{from.email || '(SENDER_EMAIL vazio)'}&gt;
      <br />
      Para: <span className="mono">{to}</span>
      <br />
      Assunto: <b>{subject}</b>
    </div>
    <div style={{ whiteSpace: 'pre-wrap' }}>{body}</div>
  </div>
);

export const PersonalizationChip = ({ value }: { value: string }) => (
  <Chip color={value === 'evidence_based' ? 'gn' : 'gy'} dot={false}>
    {value === 'evidence_based' ? 'personalizada com evidência' : 'genérica'}
  </Chip>
);
