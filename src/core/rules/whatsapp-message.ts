import { DomainError } from '../errors.js';

export type WhatsappContext = { lead: { name: string }; sender: { name: string; nickname: string } };

// Google names are often SEO titles ("Liderar Imóveis BH - Imobiliária Belo Horizonte", "Silvio Ximenes | ..."):
// cut at the separator and drop parentheses so the greeting reads like a person wrote it.
export const shortName = (name: string): string => {
  const cut = name.split(/\s[-–|]\s/)[0]!.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  return cut || name.trim();
};

const PLACEHOLDER = /\{\{\s*([a-zA-Z.]+)\s*\}\}/g;

const values = (context: WhatsappContext): Record<string, string | undefined> => ({
  'lead.name': context.lead.name,
  'lead.shortName': shortName(context.lead.name),
  'sender.name': context.sender.name || undefined,
  'sender.nickname': context.sender.nickname || context.sender.name || undefined,
});

export const WHATSAPP_PLACEHOLDERS = Object.keys(values({ lead: { name: '' }, sender: { name: '', nickname: '' } }));

export const assertWhatsappPlaceholders = (text: string): void => {
  for (const [, key] of text.matchAll(PLACEHOLDER))
    if (!WHATSAPP_PLACEHOLDERS.includes(key!)) throw new DomainError('validation', `Placeholder desconhecido: {{${key}}}. Use: ${WHATSAPP_PLACEHOLDERS.join(', ')}`);
};

export const renderWhatsapp = (template: string, context: WhatsappContext): string => {
  const map = values(context);
  return template
    .replace(PLACEHOLDER, (_, key: string) => {
      const value = map[key];
      if (value === undefined) throw new DomainError('requirement_missing', `Sem valor para {{${key}}}${key.startsWith('sender.') ? ' (configure SENDER_NAME no .env)' : ''}`);
      return value;
    })
    .trim();
};
