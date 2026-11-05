import type { Lead } from '../core/entities/lead.js';
import { WA_MESSAGE_STATUSES } from '../core/entities/whatsapp.js';
import type { Deps } from '../core/ports/runtime.js';
import { inSendWindow, localDayStart } from '../core/rules/send-window.js';
import { countCandidates } from '../core/use-cases/leads.js';

// What the screen shows for a lead's AI judgement. "unreadable" is a site the AI could not open yet: it is retried, not judged.
export type LeadVerdictView = 'fit' | 'not_a_fit' | 'unclear' | 'unreadable' | 'no_whatsapp' | 'pending';

const verdictOf = (lead: Lead): LeadVerdictView => {
  // Without a WhatsApp number the lead cannot be contacted, so the AI never judges it.
  if (!lead.qualification) return !lead.whatsapp && lead.enrichedAt ? 'no_whatsapp' : 'pending';
  if (lead.qualification.verdict === 'unclear' && !lead.qualifiedAt) return 'unreadable';
  return lead.qualification.verdict;
};

export const leadsView = (deps: Deps) => {
  const leads = deps.store.leads.list();
  const messages = new Map(deps.store.waMessages.list().map((message) => [message.leadId, message]));
  const rows = leads.map((lead) => ({
    id: lead.id,
    name: lead.name,
    phone: lead.phone,
    phoneKind: lead.phoneKind,
    whatsapp: lead.whatsapp,
    whatsappSource: lead.whatsappSource,
    enrichedAt: lead.enrichedAt,
    enrichmentNote: lead.enrichmentNote,
    website: lead.website,
    address: lead.address,
    city: lead.city,
    state: lead.state,
    rating: lead.rating,
    reviewCount: lead.reviewCount,
    status: lead.status,
    verdict: verdictOf(lead),
    reason: lead.qualification?.reason,
    signals: lead.qualification?.signals ?? [],
    model: lead.qualification?.model,
    source: lead.source,
    createdAt: lead.createdAt,
    message: messages.has(lead.id) ? { id: messages.get(lead.id)!.id, status: messages.get(lead.id)!.status } : undefined,
  }));
  const count = (test: (row: (typeof rows)[number]) => boolean) => rows.filter(test).length;
  const { discovery } = deps.leadsConfig;
  const now = deps.clock.now();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  return {
    leads: rows,
    summary: {
      total: rows.length,
      fit: count((row) => row.verdict === 'fit'),
      unclear: count((row) => row.verdict === 'unclear' || row.verdict === 'unreadable'),
      notFit: count((row) => row.verdict === 'not_a_fit'),
      pending: count((row) => row.verdict === 'pending'),
      withWhatsapp: count((row) => !!row.whatsapp),
      noWhatsapp: count((row) => !!row.enrichedAt && !row.whatsapp),
      notRead: count((row) => !row.enrichedAt),
      contacted: count((row) => !!row.message && row.message.status === 'sent'),
    },
    discovery: {
      places: !!deps.places,
      ai: !!deps.leadQualifier && !!deps.qualifying,
      segment: deps.leadsConfig.segment,
      profile: deps.leadsConfig.profile,
      candidates: countCandidates(deps),
      minCandidates: discovery.minCandidates,
      requestsThisMonth: deps.store.leadSearches.requestsSince(monthStart),
      maxRequestsPerMonth: discovery.maxRequestsPerMonth,
      perSearchLimit: discovery.perSearchLimit,
      cooldownDays: discovery.cooldownDays,
      targets: discovery.targets.map((target) => ({ ...target, lastRan: deps.store.leadSearches.lastRan(`${deps.leadsConfig.segment} em ${[target.area, target.city, target.state].filter(Boolean).join(', ')}`) })),
    },
  };
};

export const whatsappView = (deps: Deps) => {
  const config = deps.whatsapp;
  const now = deps.clock.now();
  const messages = deps.store.waMessages.list();
  const leads = new Map(deps.store.leads.list().map((lead) => [lead.id, lead]));
  const startedToday = deps.store.waMessages.countStartedSince(localDayStart(now, config.window.timezone).toISOString());
  const counts = Object.fromEntries(WA_MESSAGE_STATUSES.map((status) => [status, messages.filter((message) => message.status === status).length])) as Record<(typeof WA_MESSAGE_STATUSES)[number], number>;
  const withMessage = new Set(messages.map((message) => message.leadId));
  return {
    channel: { name: deps.whatsappChannel.name, delivers: deps.whatsappChannel.delivers },
    config: {
      dailyLimit: config.dailyLimit,
      minIntervalSeconds: config.minIntervalSeconds,
      maxIntervalSeconds: config.maxIntervalSeconds,
      window: config.window,
      stopAfterFailures: config.stopAfterFailures,
      autoApprove: config.autoApprove,
      firstMessage: config.firstMessage,
    },
    today: { startedToday, remaining: Math.max(0, config.dailyLimit - startedToday), inWindow: inSendWindow(now, config.window) },
    counts,
    // Leads the AI approved that still have no message: what "prepare messages" would turn into drafts.
    ready: [...leads.values()].filter((lead) => lead.status === 'identified' && lead.whatsapp && lead.qualification?.verdict === 'fit' && !withMessage.has(lead.id)).length,
    messages: messages
      .map((message) => {
        const lead = leads.get(message.leadId);
        return { ...message, lead: lead ? { id: lead.id, name: lead.name, city: lead.city, state: lead.state, website: lead.website, status: lead.status } : undefined };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
};
