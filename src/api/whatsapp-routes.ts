import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DomainError } from '../core/errors.js';
import type { Deps } from '../core/ports/runtime.js';
import { discoverLeads, discoverNextLeads, enrichLeads, qualifyLeads } from '../core/use-cases/leads.js';
import { parseInput } from '../core/use-cases/shared.js';
import {
  approveWhatsapp,
  cancelWhatsapp,
  draftWhatsapp,
  editWhatsapp,
  resolveUnknownWhatsapp,
  retryWhatsapp,
  runWhatsapp,
  sendWhatsapp,
  suppressPhone,
  type RunPhase,
  type WaSendOutcome,
} from '../core/use-cases/whatsapp-queue.js';
import type { Jobs, JobTone } from './jobs.js';
import { leadsView, whatsappView } from './lead-views.js';

const body = <T extends z.ZodType>(schema: T, value: unknown): z.infer<T> => parseInput(schema, value ?? {});
const text = z.string().trim().min(1);

type Id = { Params: { id: string } };

const PHASE: Record<RunPhase, string> = {
  discovering: 'Procurando lugares novos (se faltarem candidatos)',
  reading_sites: 'Lendo os sites para achar o WhatsApp',
  qualifying: 'IA avaliando os leads',
  drafting: 'Preparando as mensagens',
  sending: 'Enviando',
};

const OUTCOME_TONE: Record<WaSendOutcome['outcome'], JobTone> = { sent: 'gn', would_send: 'gn', failed: 'rd', unknown: 'am', cancelled: 'rd', skipped: 'gy' };
const OUTCOME_LABEL: Record<WaSendOutcome['outcome'], string> = { sent: 'enviada', would_send: 'enviaria', failed: 'falhou', unknown: 'sem confirmação', cancelled: 'cancelada', skipped: 'pulada' };

// A channel that really delivers needs the same typed confirmation as real e-mail, checked here and not only in the screen.
const assertConfirmed = (deps: Deps, confirm: unknown) => {
  if (deps.whatsappChannel.delivers && confirm !== 'ENVIAR') throw new DomainError('validation', 'Envio real exige a confirmação ENVIAR.');
};

export const registerWhatsappRoutes = (app: FastifyInstance, deps: Deps, jobs: Jobs) => {
  // ------------------------------------------------------------ leads
  app.get('/api/leads', async () => leadsView(deps));

  // Searching one place by hand: with dryRun it only shows what would come in.
  app.post('/api/leads/discover', async (request) => {
    const input = body(
      z.object({
        city: text,
        state: z.string().trim().length(2).optional(),
        area: z.string().trim().optional().transform((value) => value || undefined),
        limit: z.number().int().min(1).max(60).default(20),
        dryRun: z.boolean().default(false),
      }),
      request.body,
    );
    return discoverLeads(deps, { ...input, segment: deps.leadsConfig.segment });
  });

  // ------------------------------------------------------------ tarefas
  app.get('/api/job', async () => jobs.current() ?? null);
  app.post('/api/job/stop', async () => jobs.stop() ?? null);

  app.post('/api/jobs', async (request, reply) => {
    const input = body(z.object({ kind: z.enum(['leads.auto', 'leads.enrich', 'leads.qualify', 'wa.run']), confirm: z.string().optional() }), request.body);
    if (input.kind === 'wa.run') assertConfirmed(deps, input.confirm);
    const job =
      input.kind === 'leads.auto'
        ? jobs.start(input.kind, 'Procurar leads novos', async (job) => {
            job.phase('Pesquisando no Google Places');
            const report = await discoverNextLeads(deps);
            report.searches.forEach((item) => job.log(`${item.query}: ${item.imported} novo(s)`, item.imported ? 'gn' : 'gy'));
            job.summary([report.skipped ? `Busca automática: ${report.skipped}.` : `${report.searches.length} pesquisa(s) feita(s).`]);
          })
        : input.kind === 'leads.enrich'
          ? jobs.start(input.kind, 'Ler os sites e achar o WhatsApp', async (job) => {
              job.phase('Lendo os sites das imobiliárias');
              const report = await enrichLeads(deps, { limit: 50 }, { shouldStop: job.shouldStop });
              report.found.forEach((item) => job.log(`${item.name}: ${item.whatsapp}`, 'gn'));
              report.fromListing.forEach((item) => job.log(`${item.name}: ${item.whatsapp} (celular do Google, sem confirmação)`, 'am'));
              report.notFound.forEach((item) => job.log(`${item.name}: ${item.reason}`, 'gy'));
              job.summary([`WhatsApp achado no site: ${report.found.length}. Celular do Google: ${report.fromListing.length}. Sem WhatsApp: ${report.notFound.length}.`]);
            })
          : input.kind === 'leads.qualify'
            ? jobs.start(input.kind, 'IA avalia os leads', async (job) => {
                job.phase('A IA está lendo os sites');
                const report = await qualifyLeads(deps, { limit: 50 }, { shouldStop: job.shouldStop });
                const count = (outcome: string) => report.results.filter((item) => item.outcome === outcome).length;
                for (const item of report.results) job.log(`${item.name}: ${item.reason}`, item.outcome === 'fit' ? 'gn' : item.outcome === 'not_a_fit' ? 'rd' : 'am');
                job.summary([`Bons: ${count('fit')}. Descartados: ${count('not_a_fit')}. Em dúvida: ${count('unclear')}. Site não lido: ${count('unreachable')}.`]);
              })
            : jobs.start(input.kind, 'Rotina completa de WhatsApp', async (job) => {
                const report = await runWhatsapp(deps, {
                  shouldStop: job.shouldStop,
                  onPhase: (phase) => job.phase(PHASE[phase]),
                  onEvent: (event) => {
                    if (event.type === 'waiting') return job.waiting(event.until);
                    job.waiting(undefined);
                    job.log(`${OUTCOME_LABEL[event.outcome.outcome]}: ${event.outcome.lead.name}${event.outcome.detail ? ` (${event.outcome.detail})` : ''}`, OUTCOME_TONE[event.outcome.outcome]);
                  },
                });
                const lines: string[] = [];
                if (report.discovered) lines.push(report.discovered.searches.length ? `Busca de leads: ${report.discovered.searches.map((item) => `${item.query} (${item.imported} novos)`).join('; ')}.` : `Busca de leads: ${report.discovered.skipped}.`);
                if (report.enriched) lines.push(`Sites lidos: WhatsApp achado ${report.enriched.found.length}, celular do Google ${report.enriched.fromListing.length}, sem número ${report.enriched.notFound.length}.`);
                if (report.qualified) lines.push(`IA: ${report.qualified.results.filter((item) => item.outcome === 'fit').length} bons, ${report.qualified.results.filter((item) => item.outcome === 'not_a_fit').length} descartados, ${report.qualified.results.filter((item) => item.outcome === 'unclear').length} em dúvida.`);
                if (report.qualifyNote) lines.push(`Atenção: ${report.qualifyNote}.`);
                if (report.drafted) lines.push(`Mensagens preparadas: ${report.drafted.drafted.length}.`);
                lines.push(`Enviadas agora: ${report.sent.outcomes.filter((item) => item.outcome === 'sent').length}. Restam hoje: ${report.sent.remainingToday}.`);
                if (report.sent.stopped) lines.push(`Parou: ${report.sent.stopped}`);
                job.summary(lines);
              });
    return reply.code(201).send(job);
  });

  // ------------------------------------------------------------ fila de WhatsApp
  app.get('/api/whatsapp', async () => whatsappView(deps));
  app.post('/api/whatsapp/draft', async (request) => {
    const input = body(z.object({ limit: z.number().int().min(1).max(200).optional() }), request.body);
    const report = draftWhatsapp(deps, input);
    return { drafted: report.drafted.length, skipped: report.skipped };
  });
  // Shows what a real send would do right now, without sending or writing anything.
  app.post('/api/whatsapp/dry-run', async () => {
    const report = await sendWhatsapp(deps, { dryRun: true });
    return {
      channel: report.channel,
      delivers: report.delivers,
      remainingToday: report.remainingToday,
      stopped: report.stopped,
      outcomes: report.outcomes.map((item) => ({ id: item.message.id, name: item.lead.name, phone: item.message.toPhone, outcome: item.outcome, detail: item.detail })),
    };
  });
  app.post('/api/whatsapp/approve', async (request) => {
    const input = body(z.object({ ids: z.array(text).min(1).optional(), all: z.boolean().optional() }), request.body);
    if (!input.all && !input.ids) throw new DomainError('validation', 'Escolha as mensagens ou use "todas"');
    return { approved: approveWhatsapp(deps, input.all ? 'all' : input.ids!).length };
  });
  app.put<Id>('/api/whatsapp/messages/:id', async (request) => editWhatsapp(deps, request.params.id, body(z.object({ body: z.string() }), request.body).body));
  app.post<Id>('/api/whatsapp/messages/:id/cancel', async (request) => cancelWhatsapp(deps, request.params.id, body(z.object({ reason: z.string() }), request.body).reason));
  app.post<Id>('/api/whatsapp/messages/:id/retry', async (request) => retryWhatsapp(deps, request.params.id));
  app.post<Id>('/api/whatsapp/messages/:id/resolve', async (request) => resolveUnknownWhatsapp(deps, request.params.id, body(z.object({ sent: z.boolean() }), request.body).sent));
  // A refusal: the number is blocked for good and anything waiting for it is cancelled.
  app.post('/api/whatsapp/suppress', async (request, reply) => {
    const input = body(z.object({ phone: text, reason: text }), request.body);
    return reply.code(201).send({ inserted: suppressPhone(deps, input.phone, input.reason) });
  });
};
