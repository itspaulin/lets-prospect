import { DomainError } from '../errors.js';

export const normalizeDomain = (value: string): string => {
  const trimmed = value.trim();
  let hostname: string;
  try {
    hostname = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    throw new DomainError('validation', `Site inválido: "${value}"`);
  }
  const domain = hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) throw new DomainError('validation', `Site inválido: "${value}"`);
  return domain;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizeEmail = (value: string): string => {
  const email = value.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new DomainError('validation', `E-mail inválido: "${value}"`);
  return email;
};

export const emailDomain = (email: string): string => email.slice(email.lastIndexOf('@') + 1);

export const belongsToDomain = (host: string, domain: string): boolean => host === domain || host.endsWith(`.${domain}`);

const COUNTRY_ALIASES: Record<string, string> = { UK: 'GB', USA: 'US', 'UNITED STATES': 'US', 'UNITED KINGDOM': 'GB', IRELAND: 'IE', CANADA: 'CA', AUSTRALIA: 'AU', BRAZIL: 'BR', BRASIL: 'BR' };

export const normalizeCountry = (value: string): string => {
  const upper = value.trim().toUpperCase();
  const code = COUNTRY_ALIASES[upper] ?? upper;
  if (!/^[A-Z]{2}$/.test(code)) throw new DomainError('validation', `País deve ser código ISO de 2 letras (ex.: BR, US, GB): "${value}"`);
  return code;
};

const LEGAL_SUFFIXES = /\b(inc|llc|ltd|limited|corp|corporation|co|company|plc|pty|gmbh|llp)\b\.?/g;

export const normalizeCompanyName = (name: string): string =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(/[^a-z0-9]+/g, '');

export const normalizeTechnologies = (values: string[]): string[] => {
  const seen = new Map<string, string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed && !seen.has(trimmed.toLowerCase())) seen.set(trimmed.toLowerCase(), trimmed);
  }
  return [...seen.values()];
};
