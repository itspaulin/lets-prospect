import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { COMPANY_STATUSES, PRIORITIES } from '../core/entities/company.js';
import { parseCsvText } from '../adapters/import/csv.js';
import { DomainError, type DomainErrorCode } from '../core/errors.js';
import type { Deps } from '../core/ports/runtime.js';
import type { CompanyFilter } from '../core/ports/store.js';
import { addCompany, addCompanyNote, changeCompanyStatus, checkCompanyCandidate, setNextAction, updateCompany } from '../core/use-cases/companies.js';
import { addContact, updateContact } from '../core/use-cases/contacts.js';
import { addEvidence } from '../core/use-cases/evidences.js';
import { importCompanies, importContacts, type ImportRow } from '../core/use-cases/imports.js';
import { erasePersonalData } from '../core/use-cases/privacy.js';
import { evaluateCompany } from '../core/use-cases/qualification.js';
import { parseInput } from '../core/use-cases/shared.js';
import { registerOutreachRoutes } from './outreach-routes.js';
import { ProspectJobs } from './prospect-jobs.js';
import { registerProspectRoutes } from './prospect-routes.js';
import { Jobs } from './jobs.js';
import { registerWhatsappRoutes } from './whatsapp-routes.js';
import { SendJobs } from './send-jobs.js';
import { companyDetailView, companyListView, duplicatesView, metaView, type RuntimeInfo, todayView } from './views.js';

const STATUS_BY_CODE: Record<DomainErrorCode, number> = {
  validation: 400,
  not_found: 404,
  duplicate: 409,
  invalid_transition: 409,
  requirement_missing: 422,
  provider_error: 502,
};

// Mutating requests must carry this header. Browsers cannot add it cross-site without a CORS preflight,
// which this server never answers, so other pages open in the browser cannot drive the local API.
export const CLIENT_HEADER = 'x-prospeccao';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

const list = (value: string | undefined) => (value ? value.split(',').map((item) => item.trim()).filter(Boolean) : undefined);
const optionalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();

const filterSchema = z.object({
  status: z.string().optional(),
  country: z.string().optional(),
  tech: z.string().optional(),
  priority: z.enum(PRIORITIES).optional(),
  minEmployees: z.coerce.number().int().optional(),
  maxEmployees: z.coerce.number().int().optional(),
  hasContacts: z.enum(['yes', 'no']).optional(),
  dueBy: optionalDate,
  inactiveSince: optionalDate,
  activeSince: optionalDate,
  disqualifiedReason: z.string().optional(),
});

const toFilter = (query: unknown): CompanyFilter => {
  const raw = parseInput(filterSchema, query);
  const statuses = list(raw.status);
  for (const status of statuses ?? []) if (!(COMPANY_STATUSES as readonly string[]).includes(status)) throw new DomainError('validation', `Status desconhecido: ${status}`);
  return {
    statuses: statuses as CompanyFilter['statuses'],
    countries: list(raw.country),
    technology: raw.tech,
    priority: raw.priority,
    minEmployees: raw.minEmployees,
    maxEmployees: raw.maxEmployees,
    hasContacts: raw.hasContacts === undefined ? undefined : raw.hasContacts === 'yes',
    nextActionDueBy: raw.dueBy,
    lastInteractionBefore: raw.inactiveSince,
    lastInteractionAfter: raw.activeSince,
    disqualificationReason: raw.disqualifiedReason,
  };
};

const parseCsv = (text: string): ImportRow[] => {
  try {
    return parseCsvText(text);
  } catch (error) {
    throw new DomainError('validation', `CSV inválido: ${(error as Error).message}`);
  }
};

const body = <T extends z.ZodType>(schema: T, value: unknown): z.infer<T> => parseInput(schema, value ?? {});

export type ServerOptions = { info: RuntimeInfo; webDir?: string; allowedHosts?: string[]; logger?: boolean };

export const buildServer = (deps: Deps, options: ServerOptions): FastifyInstance => {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 5 * 1024 * 1024 });

  app.addHook('onRequest', async (request, reply) => {
    const host = request.headers.host?.toLowerCase() ?? '';
    // Rejects DNS-rebinding: only requests addressed to the local host names reach the API.
    if (options.allowedHosts && !options.allowedHosts.includes(host)) return reply.code(403).send({ error: 'host não permitido' });
    if (request.method !== 'GET' && request.method !== 'HEAD' && request.headers[CLIENT_HEADER] !== '1')
      return reply.code(403).send({ error: `cabeçalho ${CLIENT_HEADER} ausente` });
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainError) return reply.code(STATUS_BY_CODE[error.code]).send({ error: error.message, code: error.code });
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: (error as Error).message });
    app.log.error(error);
    return reply.code(500).send({ error: 'Erro interno. Veja o terminal do servidor.' });
  });

  app.get('/api/meta', async () => metaView(deps, options.info));
  app.get('/api/today', async () => todayView(deps));

  app.get('/api/companies', async (request) => companyListView(deps, toFilter(request.query)));
  app.get('/api/companies/duplicates', async () => duplicatesView(deps));
  app.get('/api/companies/check', async (request) => {
    const query = body(z.object({ website: z.string().optional(), name: z.string().optional() }), request.query);
    return checkCompanyCandidate(deps, query);
  });
  app.get<{ Params: { ref: string } }>('/api/companies/:ref', async (request) => companyDetailView(deps, request.params.ref));

  app.post('/api/companies', async (request, reply) => reply.code(201).send(addCompany(deps, request.body as never)));
  app.patch<{ Params: { ref: string } }>('/api/companies/:ref', async (request) => updateCompany(deps, request.params.ref, request.body as never));
  app.post<{ Params: { ref: string } }>('/api/companies/:ref/status', async (request) => {
    const input = body(z.object({ to: z.enum(COMPANY_STATUSES), reason: z.string().optional(), override: z.boolean().optional() }), request.body);
    return changeCompanyStatus(deps, request.params.ref, input.to, { reason: input.reason, override: input.override });
  });
  app.post<{ Params: { ref: string } }>('/api/companies/:ref/evaluate', async (request) => evaluateCompany(deps, request.params.ref));
  app.put<{ Params: { ref: string } }>('/api/companies/:ref/next-action', async (request) => {
    const input = body(z.object({ at: z.string().nullable(), note: z.string().optional() }), request.body);
    return setNextAction(deps, request.params.ref, { at: input.at, note: input.note?.trim() || undefined });
  });
  app.post<{ Params: { ref: string } }>('/api/companies/:ref/notes', async (request, reply) => {
    addCompanyNote(deps, request.params.ref, body(z.object({ note: z.string() }), request.body).note);
    return reply.code(204).send();
  });
  app.post<{ Params: { ref: string } }>('/api/companies/:ref/evidences', async (request, reply) =>
    reply.code(201).send(addEvidence(deps, request.params.ref, request.body as never)),
  );
  app.post<{ Params: { ref: string } }>('/api/companies/:ref/contacts', async (request, reply) => {
    const { allowDomainMismatch, ...input } = (request.body ?? {}) as Record<string, unknown>;
    return reply.code(201).send(addContact(deps, request.params.ref, input as never, { allowDomainMismatch: allowDomainMismatch === true }));
  });

  app.patch<{ Params: { ref: string } }>('/api/contacts/:ref', async (request) => {
    const { allowDomainMismatch, reason, ...input } = (request.body ?? {}) as Record<string, unknown>;
    return updateContact(deps, request.params.ref, input as never, {
      allowDomainMismatch: allowDomainMismatch === true,
      reason: typeof reason === 'string' ? reason : undefined,
    });
  });
  app.post<{ Params: { ref: string } }>('/api/contacts/:ref/forget', async (request, reply) => {
    erasePersonalData(deps, request.params.ref, body(z.object({ reason: z.string() }), request.body).reason);
    return reply.code(204).send();
  });

  app.post<{ Params: { kind: string } }>('/api/import/:kind', async (request) => {
    const input = body(z.object({ csv: z.string().min(1, 'arquivo vazio'), dryRun: z.boolean().default(true) }), request.body);
    const rows = parseCsv(input.csv);
    if (request.params.kind === 'companies') return { rows: rows.length, ...importCompanies(deps, rows, { dryRun: input.dryRun }) };
    if (request.params.kind === 'contacts') return { rows: rows.length, ...importContacts(deps, rows, { dryRun: input.dryRun }) };
    throw new DomainError('not_found', `Importação desconhecida: ${request.params.kind}`);
  });

  registerOutreachRoutes(app, deps, options.info, new SendJobs(deps));
  registerProspectRoutes(app, deps, new ProspectJobs(deps));
  registerWhatsappRoutes(app, deps, new Jobs(deps));

  app.all('/api/*', async (_request, reply) => reply.code(404).send({ error: 'rota não encontrada' }));

  if (options.webDir) {
    const root = resolve(options.webDir);
    app.get('/*', async (request, reply) => {
      const path = decodeURIComponent(request.url.split('?')[0] ?? '/');
      const candidate = resolve(join(root, path));
      const inside = candidate === root || candidate.startsWith(root + sep);
      const file = inside && (await stat(candidate).catch(() => null))?.isFile() ? candidate : join(root, 'index.html');
      const content = await readFile(file).catch(() => null);
      if (!content) return reply.code(404).type('text/plain').send('Frontend não compilado. Rode: npm run web:build');
      return reply.type(MIME[extname(file)] ?? 'application/octet-stream').send(content);
    });
  }

  return app;
};
