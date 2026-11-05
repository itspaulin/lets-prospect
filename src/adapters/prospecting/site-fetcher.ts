import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { PageFetcher, RawPage, RawSiteRead } from '../../core/ports/pages.js';
import type { SiteFetcher, SitePage, SiteRead } from '../../core/ports/qualification.js';

const USER_AGENT = 'Mozilla/5.0 (compatible; prospeccao/0.1)';
const AGENT_TOKEN = 'prospeccao';
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;
const MAX_PAGES = 4;
const MAX_TEXT = 6_000;
// A site that renders in JavaScript serves an empty shell; that says nothing about the company.
const MIN_TOTAL_TEXT = 200;
const USEFUL_PATH = /(about|services|work|case|portfolio|projects|clients|team|company|what-we-do|solutions|expertise)/i;

const PRIVATE_V4 = [/^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];

export const isPrivateAddress = (address: string): boolean => {
  const mapped = address.toLowerCase().replace(/^::ffff:/, '');
  if (isIP(mapped) === 4) return PRIVATE_V4.some((pattern) => pattern.test(mapped));
  return mapped === '::1' || mapped === '::' || /^f[cd]/.test(mapped) || /^fe[89ab]/.test(mapped);
};

// Domains come from a third party, so never let one point the fetcher at this machine or its network.
const assertPublic = async (hostname: string): Promise<void> => {
  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true });
  if (addresses.length === 0 || addresses.some((item) => isPrivateAddress(item.address))) throw new Error('endereço não público');
};

export const htmlToText = (html: string): string =>
  html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, code: string) => (Number(code) < 0x110000 ? String.fromCodePoint(Number(code)) : ' '))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => (parseInt(code, 16) < 0x110000 ? String.fromCodePoint(parseInt(code, 16)) : ' '))
    .replace(/&nbsp;/g, ' ')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

export const usefulLinks = (html: string, base: URL, pattern: RegExp = USEFUL_PATH): string[] => {
  const found = new Set<string>();
  for (const match of html.matchAll(/<a\s[^>]*href\s*=\s*["']([^"'#]+)["']/gi)) {
    try {
      const url = new URL(match[1]!, base);
      if (!/^https?:$/.test(url.protocol) || url.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) continue;
      if (url.pathname !== '/' && pattern.test(url.pathname) && !/\.(pdf|jpe?g|png|zip)$/i.test(url.pathname)) found.add(`${url.origin}${url.pathname}`);
    } catch {
      // a malformed href is just not a link we want
    }
  }
  return [...found];
};

// Minimal robots.txt: the group for our agent, else "*". Longest matching rule wins; Allow wins ties.
export const robotsAllows = (robots: string, path: string): boolean => {
  const groups: { agents: string[]; rules: { allow: boolean; prefix: string }[] }[] = [];
  let current: (typeof groups)[number] | undefined;
  let lastWasAgent = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (current && (field === 'allow' || field === 'disallow') && value) current.rules.push({ allow: field === 'allow', prefix: value });
    }
  }
  const group = groups.find((item) => item.agents.some((agent) => agent !== '*' && AGENT_TOKEN.includes(agent))) ?? groups.find((item) => item.agents.includes('*'));
  const matching = (group?.rules ?? []).filter((rule) => path.startsWith(rule.prefix.replace(/\*$/, '')));
  const best = matching.sort((a, b) => b.prefix.length - a.prefix.length || Number(b.allow) - Number(a.allow))[0];
  return best ? best.allow : true;
};

type Fetched = { url: string; body: string } | { problem: string };

const describeError = (error: unknown): string => {
  const err = error as Error & { cause?: { code?: string } };
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'tempo esgotado';
  if (err.message === 'endereço não público') return err.message;
  return `erro de rede${err.cause?.code ? ` (${err.cause.code})` : ''}`;
};

export class HttpSiteFetcher implements SiteFetcher, PageFetcher {
  // robots.txt per origin, read once per site instead of once per page.
  private readonly robots = new Map<string, string | null>();

  constructor(private readonly fetchImpl: typeof fetch = fetch, private readonly checkHost: (hostname: string) => Promise<void> = assertPublic) {}

  async fetchSite(domain: string): Promise<SiteRead> {
    const home = await this.home(domain);
    if ('problem' in home) return { pages: [], problem: home.problem };
    const pages: SitePage[] = [{ url: home.url, text: htmlToText(home.body).slice(0, MAX_TEXT) }];
    const seen = new Set([normalizeUrl(home.url)]);
    for (const link of usefulLinks(home.body, new URL(home.url))) {
      if (pages.length >= MAX_PAGES) break;
      const page = await this.get(new URL(link));
      if ('problem' in page || seen.has(normalizeUrl(page.url))) continue;
      seen.add(normalizeUrl(page.url));
      pages.push({ url: page.url, text: htmlToText(page.body).slice(0, MAX_TEXT) });
    }
    const readable = pages.filter((page) => page.text.length > 0);
    if (readable.reduce((sum, page) => sum + page.text.length, 0) < MIN_TOTAL_TEXT)
      return { pages: [], problem: 'sem texto legível (site montado por JavaScript ou redirecionamento no navegador)' };
    return { pages: readable };
  }

  // The raw HTML keeps links and attributes (wa.me buttons, tel: links) that the plain-text read throws away.
  async fetchRaw(domain: string, options: { linkPattern: RegExp; maxPages: number }): Promise<RawSiteRead> {
    const home = await this.home(domain);
    if ('problem' in home) return { pages: [], problem: home.problem };
    const pages: RawPage[] = [{ url: home.url, html: home.body }];
    const seen = new Set([normalizeUrl(home.url)]);
    for (const link of usefulLinks(home.body, new URL(home.url), options.linkPattern)) {
      if (pages.length >= options.maxPages) break;
      const page = await this.get(new URL(link));
      if ('problem' in page || seen.has(normalizeUrl(page.url))) continue;
      seen.add(normalizeUrl(page.url));
      pages.push({ url: page.url, html: page.body });
    }
    return { pages };
  }

  // Slow or flaky servers often answer on the second try; a refusal (403, robots) will not change.
  private async home(domain: string): Promise<Fetched> {
    const url = new URL(`https://${domain}/`);
    const first = await this.get(url);
    return 'problem' in first && /tempo esgotado|erro de rede/.test(first.problem) ? this.get(url) : first;
  }

  private async get(start: URL, redirects = 0): Promise<Fetched> {
    try {
      await this.checkHost(start.hostname);
      if (!(await this.allowedByRobots(start))) return { problem: 'robots.txt não permite' };
      const response = await this.fetchImpl(start, { redirect: 'manual', headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location || redirects >= MAX_REDIRECTS) return { problem: 'redirecionamentos demais' };
        return this.get(new URL(location, start), redirects + 1);
      }
      if (response.status === 401 || response.status === 403 || response.status === 429) return { problem: `bloqueado para robôs (HTTP ${response.status})` };
      if (!response.ok) return { problem: `HTTP ${response.status}` };
      if (!(response.headers.get('content-type') ?? '').includes('text/html')) return { problem: 'resposta não é HTML' };
      return { url: start.href, body: await readCapped(response) };
    } catch (error) {
      return { problem: describeError(error) };
    }
  }

  private async allowedByRobots(url: URL): Promise<boolean> {
    if (!this.robots.has(url.origin)) {
      try {
        const response = await this.fetchImpl(new URL('/robots.txt', url.origin), { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'manual' });
        this.robots.set(url.origin, response.ok ? await readCapped(response) : null);
      } catch {
        this.robots.set(url.origin, null);
      }
    }
    const robots = this.robots.get(url.origin);
    return robots == null || robotsAllows(robots, url.pathname);
  }
}

const normalizeUrl = (url: string): string => url.replace(/\/+$/, '');

const readCapped = async (response: Response): Promise<string> => {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  while (bytes < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    text += decoder.decode(value, { stream: true });
  }
  await reader.cancel().catch(() => undefined);
  return text;
};
