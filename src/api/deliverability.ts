import { resolveMx, resolveTxt } from 'node:dns/promises';

const WEBMAIL = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'proton.me', 'protonmail.com', 'zohomail.com']);
// Common DKIM selectors; Zoho uses "zmail" unless changed in its panel.
const DKIM_SELECTORS = ['zmail', 'default', 'google', 'selector1', 'selector2', 'k1', 'mail'];

const withTimeout = <T>(work: Promise<T>, ms = 5000): Promise<T> =>
  Promise.race([work, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('tempo esgotado')), ms))]);

const txt = async (name: string): Promise<string[]> => {
  try {
    return (await withTimeout(resolveTxt(name))).map((parts) => parts.join(''));
  } catch {
    return [];
  }
};

export type Check = { id: string; label: string; ok: boolean; detail: string };

// Reads public DNS only. A pass here means the records exist, not that a provider accepts them:
// the real proof is the SMTP test with SPF, DKIM and DMARC showing "pass" in the headers.
export const checkDeliverability = async (senderEmail: string | undefined) => {
  const domain = senderEmail?.split('@')[1]?.toLowerCase();
  if (!domain) return { domain: undefined, checks: [] as Check[], note: 'Configure SENDER_EMAIL no .env para verificar o domínio.' };
  if (WEBMAIL.has(domain))
    return { domain, checks: [] as Check[], note: `${domain} é webmail: use uma caixa no seu próprio domínio para prospecção (SPF, DKIM e DMARC próprios).` };

  const [mx, root, dmarc, dkim] = await Promise.all([
    withTimeout(resolveMx(domain)).catch(() => []),
    txt(domain),
    txt(`_dmarc.${domain}`),
    Promise.all(DKIM_SELECTORS.map(async (selector) => ({ selector, records: await txt(`${selector}._domainkey.${domain}`) }))),
  ]);
  const spf = root.find((record) => record.toLowerCase().startsWith('v=spf1'));
  const dmarcRecord = dmarc.find((record) => record.toLowerCase().startsWith('v=dmarc1'));
  const dkimFound = dkim.find((item) => item.records.some((record) => /(^|;)\s*p=/.test(record)));
  const checks: Check[] = [
    { id: 'mx', label: 'MX (recebimento)', ok: mx.length > 0, detail: mx.length ? mx.map((record) => record.exchange).join(', ') : 'nenhum registro MX' },
    { id: 'spf', label: 'SPF', ok: !!spf, detail: spf ?? 'nenhum TXT v=spf1 no domínio' },
    {
      id: 'dkim',
      label: 'DKIM',
      ok: !!dkimFound,
      detail: dkimFound ? `seletor ${dkimFound.selector}` : `nenhuma chave nos seletores comuns (${DKIM_SELECTORS.join(', ')})`,
    },
    { id: 'dmarc', label: 'DMARC', ok: !!dmarcRecord, detail: dmarcRecord ?? `nenhum TXT em _dmarc.${domain}` },
  ];
  return { domain, checks, note: undefined };
};
