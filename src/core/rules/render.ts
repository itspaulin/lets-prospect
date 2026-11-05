import { createHash } from 'node:crypto';
import type { Personalization } from '../entities/outreach.js';
import { DomainError } from '../errors.js';

export type RenderContext = {
  company: { name: string; matchingTechnologies: string[] };
  contact: { name: string };
  sender: { name: string; postalAddress: string; email: string };
  reason?: string;
  // Personal, signed opt-out link. Absent until the unsubscribe service is configured.
  unsubscribeUrl?: string;
};

// "Node.js", "Node.js e React", "Node.js, React e AWS".
const listWithAnd = (items: string[]): string => (items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} e ${items.at(-1)}`);

const PLACEHOLDER = /\{\{\s*([a-zA-Z.]+)\s*\}\}/g;

const values = (context: RenderContext): Record<string, string | undefined> => ({
  'company.name': context.company.name,
  'contact.name': context.contact.name,
  'contact.firstName': context.contact.name.split(/\s+/)[0],
  'sender.name': context.sender.name || undefined,
  'sender.email': context.sender.email || undefined,
  'sender.postalAddress': context.sender.postalAddress || undefined,
  stack: context.company.matchingTechnologies.length ? listWithAnd(context.company.matchingTechnologies) : undefined,
  reason: context.reason?.trim() || undefined,
  unsubscribeUrl: context.unsubscribeUrl,
});

export const SUPPORTED_PLACEHOLDERS = Object.keys(values({ company: { name: '', matchingTechnologies: [] }, contact: { name: '' }, sender: { name: '', postalAddress: '', email: '' } }));

export const assertTemplatePlaceholders = (text: string): void => {
  for (const [, key] of text.matchAll(PLACEHOLDER))
    if (!SUPPORTED_PLACEHOLDERS.includes(key!)) throw new DomainError('validation', `Placeholder desconhecido: {{${key}}}. Use: ${SUPPORTED_PLACEHOLDERS.join(', ')}`);
};

const fill = (text: string, map: Record<string, string | undefined>): string =>
  text.replace(PLACEHOLDER, (_, key: string) => {
    const value = map[key];
    if (value === undefined)
      throw new DomainError('requirement_missing', `Sem valor para {{${key}}}${key.startsWith('sender.') ? ' (configure SENDER_NAME, SENDER_EMAIL e SENDER_POSTAL_ADDRESS no .env)' : ''}`);
    return value;
  });

// Lines that use {{reason}} or {{stack}} are dropped when there is no verified basis for them, so a
// message never pretends to have done research it did not do. Without a reason the draft is generic.
export const renderMessage = (
  template: { subject: string; body: string },
  footer: string,
  context: RenderContext,
): { subject: string; body: string; personalization: Personalization } => {
  const map = values(context);
  const optional = ['reason', 'stack'].filter((key) => map[key] === undefined);
  const body = template.body
    .split('\n')
    .filter((line) => !optional.some((key) => new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`).test(line)))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return {
    subject: fill(template.subject, map).trim(),
    body: `${fill(body, map)}\n\n${fill(footer, map).trim()}`,
    personalization: map.reason ? 'evidence_based' : 'generic',
  };
};

// The footer with the clickable opt-out only when there is a link to put in it.
export const footerFor = (sending: { footer: string; footerWithLink?: string }, unsubscribeUrl: string | undefined): string =>
  unsubscribeUrl && sending.footerWithLink ? sending.footerWithLink : sending.footer;

export const contentHash = (message: { toEmail: string; subject: string; body: string }): string =>
  createHash('sha256').update(JSON.stringify([message.toEmail, message.subject, message.body])).digest('hex');

export const hashValue = (value: string): string => createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
