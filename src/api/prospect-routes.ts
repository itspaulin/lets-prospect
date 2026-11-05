import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../core/ports/runtime.js';
import { aiReviewQueue, pendingQualification, qualifyCompany } from '../core/use-cases/ai-qualification.js';
import { BR_KEYWORDS, discoverCompanies, findContacts } from '../core/use-cases/prospecting.js';
import { parseInput } from '../core/use-cases/shared.js';
import type { ProspectJobs } from './prospect-jobs.js';

export const HEADCOUNTS = ['1-10', '11-50', '51-200', '201-500', '501-1000'] as const;

const search = z.object({
  country: z.string().trim().min(1, 'escolha o país'),
  state: z.string().trim().optional().transform((value) => value || undefined),
  city: z.string().trim().optional().transform((value) => value || undefined),
  headcount: z.array(z.enum(HEADCOUNTS)).optional(),
  keywords: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

const funnel = z.object({
  contacts: z.boolean().default(true),
  maxCredits: z.number().int().min(1).max(100).default(5),
  perCompany: z.number().int().min(1).max(5).default(2),
});

const defaultFunnel = { contacts: true, maxCredits: 5, perCompany: 2 };
const jobBody = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('search'), search, funnel: funnel.default(defaultFunnel) }),
  z.object({ mode: z.literal('pending'), limit: z.number().int().min(1).max(200).optional(), funnel: funnel.default(defaultFunnel) }),
  z.object({ mode: z.literal('retry'), domains: z.array(z.string().min(1)).min(1, 'escolha ao menos uma empresa').max(100), funnel: funnel.default(defaultFunnel) }),
]);

// "US · NY · New York · 11-50, 51-200", the way the history table shows a search.
const describe = (input: z.infer<typeof search>) =>
  [input.country.toUpperCase(), input.state?.toUpperCase(), input.city, input.headcount?.length ? input.headcount.join(', ') : undefined].filter(Boolean).join(' · ');

// The balance is a free Hunter call; a failure there only hides the number, it never breaks the screen.
const credits = async (deps: Deps): Promise<{ credits?: number; error?: string }> => {
  if (!deps.prospecting) return {};
  try {
    return { credits: await deps.prospecting.finder.creditsRemaining() };
  } catch (error) {
    return { error: (error as Error).message };
  }
};

export const registerProspectRoutes = (app: FastifyInstance, deps: Deps, jobs: ProspectJobs) => {
  app.get('/api/prospect', async () => ({
    hunter: { configured: !!deps.prospecting, ...(await credits(deps)) },
    ai: { configured: !!deps.qualifying, model: deps.qualifying?.qualifier.name },
    pending: pendingQualification(deps).length,
    review: aiReviewQueue(deps).map((item) => ({
      kind: item.kind,
      note: item.note,
      at: item.at,
      company: { name: item.company.name, domain: item.company.domain, website: item.company.website, country: item.company.country, region: item.company.region },
    })),
    runs: deps.store.prospectRuns.recent(10),
    defaults: { keywords: BR_KEYWORDS, headcounts: HEADCOUNTS },
  }));

  // Free: shows what a search would import without writing anything.
  app.post('/api/prospect/preview', async (request) => discoverCompanies(deps, { ...parseInput(search, request.body ?? {}), dryRun: true }));

  app.post('/api/prospect/jobs', async (request, reply) => {
    const input = parseInput(jobBody, request.body ?? {});
    const job =
      input.mode === 'search'
        ? jobs.start({ mode: 'search', input: { ...input.search, ...input.funnel }, label: describe(input.search) })
        : input.mode === 'pending'
          ? jobs.start({ mode: 'pending', input: { ...input.funnel, limit: input.limit }, label: 'Pendentes da base' })
          : jobs.start({ mode: 'retry', input: { ...input.funnel, domains: input.domains }, label: `Tentar de novo: ${input.domains.length === 1 ? input.domains[0] : `${input.domains.length} empresas`}` });
    return reply.code(201).send(job);
  });
  app.get('/api/prospect/job', async () => jobs.current() ?? null);
  app.post('/api/prospect/job/stop', async () => jobs.stop() ?? null);

  app.post<{ Params: { ref: string } }>('/api/companies/:ref/ai-qualify', async (request) => qualifyCompany(deps, request.params.ref));
  app.post<{ Params: { ref: string } }>('/api/companies/:ref/find-contacts', async (request) => {
    const input = parseInput(z.object({ perCompany: z.number().int().min(1).max(5).default(2) }), request.body ?? {});
    return findContacts(deps, [request.params.ref], { maxCredits: 1, perCompany: input.perCompany });
  });
};
