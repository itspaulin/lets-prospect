import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PRIORITIES } from '../core/entities/company.js';
import { REPLY_CATEGORIES } from '../core/entities/outreach.js';
import { DomainError } from '../core/errors.js';
import type { Deps } from '../core/ports/runtime.js';
import { emailDomain, normalizeDomain, normalizeEmail } from '../core/rules/normalize.js';
import { normalizeBrazilPhone } from '../core/rules/phone.js';
import { hashValue } from '../core/rules/render.js';
import { scoringConfigSchema } from '../core/rules/scoring-config.js';
import { sendingConfigSchema } from '../core/rules/sending-config.js';
import {
  activateCampaign,
  addTarget,
  approveTemplate,
  closeCampaign,
  createCampaign,
  pauseCampaign,
  selectTargets,
  setTemplate,
} from '../core/use-cases/campaigns.js';
import { draftDueFollowUps } from '../core/use-cases/followups.js';
import { approveMessage, cancelMessage, draftAll, draftMessage, editMessage, previewMessage, retryFailedMessage } from '../core/use-cases/messages.js';
import { correctReply, recordReply } from '../core/use-cases/replies.js';
import { buildReport } from '../core/use-cases/report.js';
import { resolveUnknown, sendApproved } from '../core/use-cases/send.js';
import { parseInput } from '../core/use-cases/shared.js';
import { suppressDomain, suppressEmail } from '../core/use-cases/suppressions.js';
import { suppressPhone } from '../core/use-cases/whatsapp-queue.js';
import { checkDeliverability } from './deliverability.js';
import { compactOutcome, type SendJobs } from './send-jobs.js';
import {
  campaignDetailView,
  campaignsView,
  conciliationView,
  followUpsView,
  personalizeView,
  replyContactsView,
  repliesView,
  reviewQueueView,
  type RuntimeInfo,
  settingsView,
  suppressionsView,
} from './views.js';

const body = <T extends z.ZodType>(schema: T, value: unknown): z.infer<T> => parseInput(schema, value ?? {});
const text = z.string().trim().min(1);
const optionalText = z.string().trim().optional().transform((value) => value || undefined);
const step = z.coerce.number().int().min(0);

type Ref = { Params: { ref: string } };
type Id = { Params: { id: string } };

// Real sends need the user to type ENVIAR, checked here and not only in the screen.
const assertConfirmed = (deps: Deps, confirm: unknown) => {
  if (deps.email.delivers && confirm !== 'ENVIAR') throw new DomainError('validation', 'Envio real exige a confirmação ENVIAR.');
};

export const registerOutreachRoutes = (app: FastifyInstance, deps: Deps, info: RuntimeInfo, jobs: SendJobs) => {
  // ------------------------------------------------------------ campanhas
  app.get('/api/campaigns', async () => campaignsView(deps));
  app.post('/api/campaigns', async (request, reply) => {
    const input = body(z.object({ name: text, market: optionalText, segment: optionalText, criteria: optionalText, notes: optionalText }), request.body);
    return reply.code(201).send(createCampaign(deps, input));
  });
  app.get<Ref>('/api/campaigns/:ref', async (request) => campaignDetailView(deps, request.params.ref, info));
  app.put<{ Params: { ref: string; step: string } }>('/api/campaigns/:ref/templates/:step', async (request) => {
    const input = body(z.object({ subject: text, body: text }), request.body);
    return setTemplate(deps, request.params.ref, { step: Number(request.params.step), ...input });
  });
  app.post<{ Params: { ref: string; step: string } }>('/api/campaigns/:ref/templates/:step/approve', async (request) =>
    approveTemplate(deps, request.params.ref, Number(request.params.step)),
  );
  app.post<Ref>('/api/campaigns/:ref/preview', async (request) => {
    const input = body(
      z.object({ step, subject: z.string().optional(), body: z.string().optional(), companyRef: optionalText, reason: optionalText }),
      request.body,
    );
    return previewMessage(deps, request.params.ref, input);
  });
  app.post<Ref>('/api/campaigns/:ref/activate', async (request) => activateCampaign(deps, request.params.ref));
  app.post<Ref>('/api/campaigns/:ref/pause', async (request) => pauseCampaign(deps, request.params.ref));
  app.post<Ref>('/api/campaigns/:ref/close', async (request) => closeCampaign(deps, request.params.ref));
  app.post<Ref>('/api/campaigns/:ref/targets', async (request, reply) => {
    const input = body(z.object({ company: text, contact: optionalText }), request.body);
    return reply.code(201).send(addTarget(deps, request.params.ref, input.company, input.contact));
  });
  app.post<Ref>('/api/campaigns/:ref/select', async (request) => {
    const input = body(
      z.object({ countries: z.array(z.string()).optional(), priority: z.enum(PRIORITIES).optional(), limit: z.number().int().positive().optional() }),
      request.body,
    );
    const result = selectTargets(deps, request.params.ref, input);
    return {
      added: result.added.map((item) => ({ domain: item.company.domain, name: item.company.name, contact: item.contact.name })),
      skipped: result.skipped.map((item) => ({ domain: item.company.domain, name: item.company.name, reason: item.reason })),
    };
  });
  app.post<Ref>('/api/campaigns/:ref/draft-all', async (request) => {
    const result = draftAll(deps, request.params.ref);
    return { drafted: result.drafted.length, skipped: result.skipped };
  });
  app.post<Ref>('/api/campaigns/:ref/drafts', async (request) => {
    const input = body(z.object({ company: text, step: step.optional(), reason: optionalText, evidenceIds: z.array(z.string()).optional() }), request.body);
    return draftMessage(deps, request.params.ref, { companyRef: input.company, step: input.step, reason: input.reason, evidenceIds: input.evidenceIds });
  });
  app.post<Ref>('/api/campaigns/:ref/followups/draft', async (request) => {
    const result = draftDueFollowUps(deps, request.params.ref);
    return { drafted: result.drafted.length, skipped: result.skipped };
  });
  app.get<{ Params: { ref: string; domain: string } }>('/api/campaigns/:ref/personalize/:domain', async (request) =>
    personalizeView(deps, request.params.ref, request.params.domain),
  );

  // ------------------------------------------------------------ envio
  app.post<Ref>('/api/campaigns/:ref/send', async (request) => {
    const input = body(z.object({ dryRun: z.boolean().default(true), confirm: z.string().optional() }), request.body);
    if (input.dryRun) {
      const report = await sendApproved(deps, request.params.ref, { dryRun: true });
      return {
        outcomes: report.outcomes.map(compactOutcome),
        remainingToday: report.remainingToday,
        dailyLimit: deps.sending.dailyLimit,
        minIntervalSeconds: deps.sending.minIntervalSeconds,
        transport: info.transport,
        delivers: info.delivers,
        from: { name: deps.sender.name, email: deps.sender.email },
      };
    }
    assertConfirmed(deps, input.confirm);
    return jobs.start(request.params.ref);
  });
  app.get('/api/send-job', async () => jobs.current() ?? null);
  app.post('/api/send-job/stop', async () => jobs.stop() ?? null);

  // ------------------------------------------------------------ mensagens
  app.get<{ Querystring: { campaign?: string } }>('/api/review', async (request) => reviewQueueView(deps, request.query.campaign || undefined));
  app.put<Id>('/api/messages/:id', async (request) => editMessage(deps, request.params.id, body(z.object({ subject: z.string(), body: z.string() }), request.body)));
  app.post<Id>('/api/messages/:id/approve', async (request) => approveMessage(deps, request.params.id));
  app.post<Id>('/api/messages/:id/cancel', async (request) => cancelMessage(deps, request.params.id, body(z.object({ reason: text }), request.body).reason));
  app.post<Id>('/api/messages/:id/retry', async (request) => retryFailedMessage(deps, request.params.id));
  app.post<Id>('/api/messages/:id/resolve', async (request) => {
    const input = body(z.object({ sent: z.boolean(), note: optionalText }), request.body);
    return resolveUnknown(deps, request.params.id, input.sent, input.note);
  });
  app.get('/api/conciliation', async () => conciliationView(deps));

  // ------------------------------------------------------------ acompanhamento
  app.get('/api/followups', async () => followUpsView(deps));
  app.get('/api/replies', async () => repliesView(deps));
  app.get('/api/replies/contacts', async () => replyContactsView(deps));
  app.post('/api/replies', async (request, reply) => {
    const input = body(
      z.object({ contact: text, category: z.enum(REPLY_CATEGORIES), summary: optionalText, receivedAt: optionalText, messageId: optionalText }),
      request.body,
    );
    const { contact, ...rest } = input;
    return reply.code(201).send(recordReply(deps, contact, rest));
  });
  app.post<Id>('/api/replies/:id/correct', async (request) => correctReply(deps, request.params.id, body(z.object({ category: z.enum(REPLY_CATEGORIES) }), request.body).category));

  app.get('/api/suppressions', async () => suppressionsView(deps));
  app.get<{ Querystring: { value?: string } }>('/api/suppressions/check', async (request) => {
    const value = request.query.value?.trim() ?? '';
    if (!value) throw new DomainError('validation', 'Informe um e-mail, domínio ou telefone');
    // A string of digits, spaces and phone punctuation is a phone number, not a domain.
    if (/^\+?[\d\s().-]{8,}$/.test(value)) {
      const phone = normalizeBrazilPhone(value);
      if (!phone) throw new DomainError('validation', `Telefone inválido: "${value}"`);
      const byPhone = deps.store.suppressions.has('phone', hashValue(phone.e164));
      return { value: phone.e164, suppressed: byPhone, by: byPhone ? 'phone' : undefined };
    }
    if (value.includes('@')) {
      const email = normalizeEmail(value);
      const byEmail = deps.store.suppressions.has('email', hashValue(email));
      const byDomain = deps.store.suppressions.has('domain', hashValue(emailDomain(email)));
      return { value: email, suppressed: byEmail || byDomain, by: byEmail ? 'email' : byDomain ? 'domain' : undefined };
    }
    const domain = normalizeDomain(value);
    const byDomain = deps.store.suppressions.has('domain', hashValue(domain));
    return { value: domain, suppressed: byDomain, by: byDomain ? 'domain' : undefined };
  });
  app.post('/api/suppressions', async (request, reply) => {
    const input = body(z.object({ kind: z.enum(['email', 'domain', 'phone']), value: text, reason: text }), request.body);
    const inserted = input.kind === 'email' ? suppressEmail(deps, input.value, input.reason) : input.kind === 'phone' ? suppressPhone(deps, input.value, input.reason) : suppressDomain(deps, input.value, input.reason);
    return reply.code(inserted ? 201 : 200).send({ inserted });
  });

  app.get<{ Querystring: { campaign?: string; from?: string; to?: string } }>('/api/report', async (request) => {
    const query = body(z.object({ campaign: optionalText, from: optionalText, to: optionalText }), request.query);
    return buildReport(deps, { campaignRef: query.campaign, from: query.from, to: query.to });
  });

  // ------------------------------------------------------------ configurações
  app.get('/api/settings', async () => settingsView(deps, info));
  app.get('/api/settings/deliverability', async () => checkDeliverability(deps.sender.email));
  app.post('/api/settings/test-email', async (request) => {
    const input = body(z.object({ confirm: z.string().optional() }), request.body);
    assertConfirmed(deps, input.confirm);
    if (!deps.sender.email || !deps.sender.name) throw new DomainError('requirement_missing', 'Configure SENDER_NAME e SENDER_EMAIL no .env antes do teste.');
    const result = await deps.email.send({
      from: { name: deps.sender.name, email: deps.sender.email },
      to: deps.sender.email,
      subject: 'Teste de envio (Prospecção)',
      text: `Mensagem de teste enviada pela tela de Configurações em ${deps.clock.now().toISOString()}.\n\nConfira nos cabeçalhos se SPF, DKIM e DMARC aparecem como pass.`,
      headerMessageId: `<test-${randomUUID()}@${emailDomain(deps.sender.email)}>`,
      headers: {},
    });
    return { ...result, to: deps.sender.email, transport: info.transport };
  });

  // Saved files are the source of truth; the running process switches to the new values at once.
  app.put('/api/settings/sending', async (request) => {
    const parsed = sendingConfigSchema.safeParse(request.body);
    if (!parsed.success) throw new DomainError('validation', parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
    const next = { ...parsed.data, version: deps.sending.version + 1 };
    writeFileSync(info.sendingPath, `${JSON.stringify(next, null, 2)}\n`);
    deps.sending = next;
    return next;
  });
  app.put('/api/settings/scoring', async (request) => {
    const parsed = scoringConfigSchema.safeParse(request.body);
    if (!parsed.success) throw new DomainError('validation', parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
    const next = { ...parsed.data, version: deps.scoring.version + 1 };
    writeFileSync(info.scoringPath, `${JSON.stringify(next, null, 2)}\n`);
    deps.scoring = next;
    return next;
  });
};
