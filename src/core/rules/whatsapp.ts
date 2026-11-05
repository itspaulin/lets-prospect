import { normalizeBrazilPhone, type BrazilPhone } from './phone.js';

export type WhatsappFound = { phone: BrazilPhone; via: 'link' | 'text' };

// wa.me/5531999998888, api.whatsapp.com/send?phone=..., web.whatsapp.com/send?phone=..., whatsapp://send?phone=...
// A wa.me/message/... link carries no number and does not match.
const LINK = /(?:wa\.me\/|(?:api|web)\.whatsapp\.com\/send\/?\?(?:[^"'\s<>]*?&)?phone=|whatsapp:\/\/send\/?\?(?:[^"'\s<>]*?&)?phone=)(?:\+|%2B)?(\d{10,15})/gi;

// "WhatsApp: (31) 99999-8888", "Whats app +55 31 99999-8888": a Brazilian number a few characters after the word.
const TEXT = /whats\s?app[^\d+]{0,40}((?:\+?55\s?)?\(?\d{2}\)?[\s.-]?\d{4,5}[\s.-]?\d{4})/gi;

const visibleText = (html: string): string =>
  html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ');

// Links first (a button the company put there on purpose), then numbers written next to the word WhatsApp.
export const extractWhatsapp = (html: string): WhatsappFound[] => {
  const found: WhatsappFound[] = [];
  const seen = new Set<string>();
  const add = (raw: string, via: WhatsappFound['via']) => {
    const phone = normalizeBrazilPhone(raw);
    if (!phone || seen.has(phone.e164)) return;
    seen.add(phone.e164);
    found.push({ phone, via });
  };
  for (const match of html.replace(/&amp;/g, '&').matchAll(LINK)) add(match[1]!, 'link');
  for (const match of visibleText(html).matchAll(TEXT)) add(match[1]!, 'text');
  return found;
};

// A mobile number is the likelier WhatsApp account; a landline is kept only when nothing better exists.
export const pickWhatsapp = (found: WhatsappFound[]): WhatsappFound | undefined => found.find((item) => item.phone.kind === 'mobile') ?? found[0];
