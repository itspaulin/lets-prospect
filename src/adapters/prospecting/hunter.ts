import { z } from 'zod';
import { DomainError } from '../../core/errors.js';
import type { DiscoverQuery, DiscoveredCompany, EmailFinder, FoundContact, LeadSource } from '../../core/ports/prospecting.js';

const discoverResponse = z.object({ data: z.array(z.object({ domain: z.string(), organization: z.string().nullish(), emails_count: z.object({ personal: z.number() }).nullish() })) });

const domainSearchResponse = z.object({
  data: z.object({
    emails: z.array(
      z.object({
        value: z.string(),
        confidence: z.number().nullish(),
        first_name: z.string().nullish(),
        last_name: z.string().nullish(),
        position: z.string().nullish(),
        sources: z.array(z.object({ uri: z.string() })).nullish(),
        verification: z.object({ status: z.string().nullish() }).nullish(),
      }),
    ),
  }),
});

const accountResponse = z.object({ data: z.object({ requests: z.object({ credits: z.object({ remaining: z.number() }) }) }) });

// Hunter's industry taxonomy. Agencies file themselves under either; keywords narrow it to client work.
const SERVICE_INDUSTRIES = ['IT Services and IT Consulting', 'Software Development'];

const BASE_URL = 'https://api.hunter.io/v2';

export type HunterOptions = { apiKey: string; fetch?: typeof fetch; baseUrl?: string };

export class HunterClient implements LeadSource, EmailFinder {
  readonly name = 'hunter.io';
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(options: HunterOptions) {
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? fetch;
    this.baseUrl = options.baseUrl ?? BASE_URL;
  }

  // Structured filters only. A natural-language `query` makes Hunter's parser rebuild the filters and drop
  // ours, and it maps "agency" to the Software Development industry, which is mostly product companies.
  async discover(query: DiscoverQuery): Promise<DiscoveredCompany[]> {
    const location = { country: query.country, ...(query.state ? { state: query.state } : {}), ...(query.city ? { city: query.city } : {}) };
    const body = {
      headquarters_location: { include: [location] },
      industry: { include: SERVICE_INDUSTRIES },
      headcount: query.headcount?.length ? query.headcount : undefined,
      keywords: query.keywords.length ? { include: query.keywords, match: 'any' } : undefined,
      limit: Math.min(query.limit, 100),
    };
    const json = await this.request('/discover', { method: 'POST', body: JSON.stringify(body) });
    return parse(discoverResponse, json, 'discover').data.map((item) => ({ domain: item.domain, name: item.organization?.trim() || item.domain, personalEmails: item.emails_count?.personal }));
  }

  async creditsRemaining(): Promise<number> {
    const json = await this.request('/account');
    return parse(accountResponse, json, 'account').data.requests.credits.remaining;
  }

  // Only named people in senior or executive roles: generic mailboxes (hello@) are not decision makers.
  async findDecisionMakers(domain: string, options: { limit: number }): Promise<FoundContact[]> {
    const params = new URLSearchParams({
      domain,
      type: 'personal',
      seniority: 'senior,executive',
      required_field: 'full_name,position',
      limit: String(options.limit),
    });
    const json = await this.request(`/domain-search?${params}`);
    return parse(domainSearchResponse, json, 'domain-search').data.emails.map((item) => ({
      email: item.value,
      name: [item.first_name, item.last_name].filter(Boolean).join(' '),
      role: item.position ?? undefined,
      confidence: item.confidence ?? undefined,
      verification: item.verification?.status === 'valid' ? 'valid' : item.verification?.status === 'invalid' ? 'invalid' : 'unknown',
      sources: (item.sources ?? []).map((source) => source.uri),
    }));
  }

  private async request(path: string, init: { method?: string; body?: string } = {}): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: { 'X-API-KEY': this.apiKey, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    });
    if (response.ok) return response.json();
    const detail = await response.text().catch(() => '');
    if (response.status === 401) throw new DomainError('provider_error', 'Hunter recusou a chave de API (401). Confira HUNTER_API_KEY.');
    if (response.status === 429) throw new DomainError('provider_error', 'Hunter: limite de uso do plano atingido (429).');
    if (response.status === 403) throw new DomainError('provider_error', 'Hunter: limite de requisições por segundo ou minuto (403). Tente em instantes.');
    const message = (() => {
      try {
        return (JSON.parse(detail) as { errors?: { details?: string }[] }).errors?.map((error) => error.details).join('; ');
      } catch {
        return undefined;
      }
    })();
    throw new DomainError('provider_error', `Hunter respondeu ${response.status}: ${(message || detail).slice(0, 200)}`);
  }
}

const parse = <T extends z.ZodType>(schema: T, json: unknown, endpoint: string): z.infer<T> => {
  const result = schema.safeParse(json);
  if (!result.success) throw new DomainError('provider_error', `Resposta inesperada do Hunter em ${endpoint}: ${result.error.issues[0]?.path.join('.')} ${result.error.issues[0]?.message}`);
  return result.data;
};
