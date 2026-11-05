// Everything is stored in UTC; the screens show Brasília time and keep UTC in the tooltip.
export const TZ = 'America/Sao_Paulo';

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const parts = (date: Date, timeZone: string) => {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return { year: values.year!, month: Number(values.month), day: Number(values.day), hour: values.hour === '24' ? '00' : values.hour!, minute: values.minute! };
};

export const utcLabel = (iso: string): string => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

export const brTime = (iso: string): string => {
  const p = parts(new Date(iso), TZ);
  return `${p.hour}:${p.minute}`;
};

export const brDateTime = (iso: string, withYear = false): string => {
  const p = parts(new Date(iso), TZ);
  return `${p.day} ${MONTHS[p.month - 1]}${withYear ? ` ${p.year}` : ''}, ${p.hour}:${p.minute}`;
};

// A calendar date (AAAA-MM-DD) has no time zone: format it as is.
export const shortDate = (day: string, withYear = false): string => {
  const [year, month, date] = day.slice(0, 10).split('-');
  return `${Number(date)} ${MONTHS[Number(month) - 1]}${withYear ? ` ${year}` : ''}`;
};

export const brToday = (now = new Date()): string => {
  const p = parts(now, TZ);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
};

const dayNumber = (day: string) => Date.parse(`${day.slice(0, 10)}T00:00:00Z`) / 86_400_000;

export const relativeDay = (day: string, today: string): { label: string; overdue: boolean; isToday: boolean } => {
  const diff = dayNumber(day) - dayNumber(today);
  if (diff === 0) return { label: 'hoje', overdue: false, isToday: true };
  if (diff === -1) return { label: 'venceu ontem', overdue: true, isToday: false };
  if (diff < 0) return { label: `venceu há ${-diff} dias`, overdue: true, isToday: false };
  if (diff === 1) return { label: 'amanhã', overdue: false, isToday: false };
  return { label: `em ${diff} dias`, overdue: false, isToday: false };
};

export const longToday = (now = new Date()): string =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now).replace(/^./, (c) => c.toUpperCase());

export const brHourFraction = (now = new Date()): number => {
  const p = parts(now, TZ);
  return Number(p.hour) + Number(p.minute) / 60;
};

export const untilUtcMidnight = (now = new Date()): string => {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const minutes = Math.max(0, Math.round((next - now.getTime()) / 60_000));
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
};

export const pct = (value: number) => `${Math.round(value * 100)}%`;

export const MONTH_NAMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// "agora", "há 35 min", "há 3 h"; older than a day falls back to the Brasília date and time.
export const relativeTime = (iso: string, now = Date.now()): string => {
  const minutes = Math.round((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  if (minutes < 24 * 60) return `há ${Math.round(minutes / 60)} h`;
  return brDateTime(iso);
};
