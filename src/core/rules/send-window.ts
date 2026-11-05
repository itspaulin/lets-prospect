import type { WhatsappConfig } from './whatsapp-config.js';

type Window = WhatsappConfig['window'];

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

const localParts = (now: Date, timeZone: string) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return { weekday: WEEKDAYS[parts.weekday!]!, year: +parts.year!, month: +parts.month!, day: +parts.day!, hour: +parts.hour!, minute: +parts.minute!, second: +parts.second! };
};

export const inSendWindow = (now: Date, window: Window): boolean => {
  const local = localParts(now, window.timezone);
  return window.days.includes(local.weekday) && local.hour >= window.startHour && local.hour < window.endHour;
};

// The instant today began in the window's time zone, so "per day" means the lead's calendar day, not UTC's.
export const localDayStart = (now: Date, timeZone: string): Date => {
  const local = localParts(now, timeZone);
  const offsetMs = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(local.year, local.month - 1, local.day) - offsetMs);
};
