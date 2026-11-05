import { useCallback, useEffect, useState } from 'react';
import type {
  campaignDetailView,
  campaignsView,
  companyDetailView,
  companyListView,
  conciliationView,
  duplicatesView,
  followUpsView,
  metaView,
  personalizeView,
  replyContactsView,
  repliesView,
  reviewQueueView,
  settingsView,
  suppressionsView,
  todayView,
} from '../../src/api/views.js';
import type { Job } from '../../src/api/jobs.js';
import type { leadsView, whatsappView } from '../../src/api/lead-views.js';
import type { SendJob, JobOutcome } from '../../src/api/send-jobs.js';
import type { DiscoverLeadsReport } from '../../src/core/use-cases/leads.js';
import type { ProspectJob } from '../../src/api/prospect-jobs.js';
import type { QualifyResult, ReviewKind } from '../../src/core/use-cases/ai-qualification.js';
import type { ProspectRun } from '../../src/core/entities/prospect-run.js';
import type { DiscoverReport, FindContactsReport } from '../../src/core/use-cases/prospecting.js';
import type { Report, Rate } from '../../src/core/use-cases/report.js';
import type { Company } from '../../src/core/entities/company.js';
import type { Contact } from '../../src/core/entities/contact.js';
import type { Evidence } from '../../src/core/entities/evidence.js';
import type { CompanyCandidateCheck } from '../../src/core/use-cases/companies.js';
import type { ImportReport } from '../../src/core/use-cases/imports.js';

export type { Company, CompanyStatus, Priority } from '../../src/core/entities/company.js';
export type { Contact } from '../../src/core/entities/contact.js';
export type { Evidence, EvidenceKind } from '../../src/core/entities/evidence.js';
export type { Interaction, InteractionType } from '../../src/core/entities/interaction.js';
export type { CriterionOutcome } from '../../src/core/entities/qualification.js';

export type Meta = ReturnType<typeof metaView>;
export type Today = ReturnType<typeof todayView>;
export type CompanyRow = ReturnType<typeof companyListView>[number];
export type CompanyDetail = ReturnType<typeof companyDetailView>;
export type ContactView = CompanyDetail['contacts'][number];
export type DuplicateGroup = ReturnType<typeof duplicatesView>[number];
export type CandidateCheck = CompanyCandidateCheck;
export type ImportResult = ImportReport & { rows: number };
export type CampaignListItem = ReturnType<typeof campaignsView>[number];
export type CampaignDetail = ReturnType<typeof campaignDetailView>;
export type ReviewItem = ReturnType<typeof reviewQueueView>[number];
export type PersonalizeData = ReturnType<typeof personalizeView>;
export type Conciliation = ReturnType<typeof conciliationView>;
export type FollowUpItem = ReturnType<typeof followUpsView>[number];
export type ReplyItem = ReturnType<typeof repliesView>[number];
export type ReplyContact = ReturnType<typeof replyContactsView>[number];
export type SuppressionItem = ReturnType<typeof suppressionsView>[number];
export type Settings = ReturnType<typeof settingsView>;
export type LeadsData = ReturnType<typeof leadsView>;
export type LeadRow = LeadsData['leads'][number];
export type WhatsappData = ReturnType<typeof whatsappView>;
export type WaMessageRow = WhatsappData['messages'][number];
export type { Job, DiscoverLeadsReport };
export type WaDryRun = {
  channel: string;
  delivers: boolean;
  remainingToday: number;
  stopped?: string;
  outcomes: { id: string; name: string; phone: string; outcome: string; detail?: string }[];
};
export type { SendJob, JobOutcome, Report, Rate, ProspectJob, DiscoverReport, QualifyResult, ProspectRun, ReviewKind };
export type ProspectStatus = {
  hunter: { configured: boolean; credits?: number; error?: string };
  ai: { configured: boolean; model?: string };
  pending: number;
  review: { kind: ReviewKind; note: string; at: string; company: { name: string; domain: string; website: string; country: string; region?: string } }[];
  runs: ProspectRun[];
  defaults: { keywords: string[]; headcounts: string[] };
};
export type ProspectSearch = { country: string; state?: string; city?: string; headcount?: string[]; keywords?: string[]; limit?: number };
export type ProspectFunnel = { contacts: boolean; maxCredits: number; perCompany: number };
export type Preview = { subject: string; body: string; personalization: 'evidence_based' | 'generic'; to: string; from: { name: string; email: string } };
export type DryRun = {
  outcomes: JobOutcome[];
  remainingToday: number;
  dailyLimit: number;
  minIntervalSeconds: number;
  transport: 'outbox' | 'smtp';
  delivers: boolean;
  from: { name: string; email: string };
};
export type Deliverability = { domain?: string; note?: string; checks: { id: string; label: string; ok: boolean; detail: string }[] };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

const request = async <T>(method: string, url: string, body?: unknown): Promise<T> => {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? { 'x-prospeccao': '1' } : { 'content-type': 'application/json', 'x-prospeccao': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({ error: `Resposta inválida do servidor (${response.status})` }));
  if (!response.ok) throw new ApiError(response.status, data.error ?? `Erro ${response.status}`, data.code);
  return data as T;
};

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body: unknown = {}) => request<T>('POST', url, body),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
};

export const companyApi = {
  add: (input: Record<string, unknown>) => api.post<{ company: Company; similar: Company[] }>('/api/companies', input),
  update: (ref: string, input: Record<string, unknown>) => api.patch<Company>(`/api/companies/${encodeURIComponent(ref)}`, input),
  status: (ref: string, to: string, reason?: string, override?: boolean) =>
    api.post<Company>(`/api/companies/${encodeURIComponent(ref)}/status`, { to, reason: reason?.trim() || undefined, override }),
  evaluate: (ref: string) => api.post<{ company: Company }>(`/api/companies/${encodeURIComponent(ref)}/evaluate`),
  nextAction: (ref: string, at: string | null, note?: string) => api.put<Company>(`/api/companies/${encodeURIComponent(ref)}/next-action`, { at, note }),
  note: (ref: string, note: string) => api.post<void>(`/api/companies/${encodeURIComponent(ref)}/notes`, { note }),
  addEvidence: (ref: string, input: Record<string, unknown>) => api.post<Evidence>(`/api/companies/${encodeURIComponent(ref)}/evidences`, input),
  addContact: (ref: string, input: Record<string, unknown>) => api.post<Contact>(`/api/companies/${encodeURIComponent(ref)}/contacts`, input),
  check: (website: string, name: string) =>
    api.get<CandidateCheck>(`/api/companies/check?${new URLSearchParams({ website, name }).toString()}`),
};

export const contactApi = {
  update: (ref: string, input: Record<string, unknown>) => api.patch<Contact>(`/api/contacts/${encodeURIComponent(ref)}`, input),
  forget: (ref: string, reason: string) => api.post<void>(`/api/contacts/${encodeURIComponent(ref)}/forget`, { reason }),
};

const campaignUrl = (ref: string, rest = '') => `/api/campaigns/${encodeURIComponent(ref)}${rest}`;

export const campaignApi = {
  create: (input: Record<string, unknown>) => api.post<{ name: string }>('/api/campaigns', input),
  saveTemplate: (ref: string, step: number, subject: string, body: string) => api.put(campaignUrl(ref, `/templates/${step}`), { subject, body }),
  approveTemplate: (ref: string, step: number) => api.post(campaignUrl(ref, `/templates/${step}/approve`)),
  preview: (ref: string, input: { step: number; subject?: string; body?: string; companyRef?: string; reason?: string }) => api.post<Preview>(campaignUrl(ref, '/preview'), input),
  activate: (ref: string) => api.post(campaignUrl(ref, '/activate')),
  pause: (ref: string) => api.post(campaignUrl(ref, '/pause')),
  close: (ref: string) => api.post(campaignUrl(ref, '/close')),
  addTarget: (ref: string, company: string, contact?: string) => api.post(campaignUrl(ref, '/targets'), { company, contact }),
  select: (ref: string, input: { countries?: string[]; priority?: string; limit?: number }) =>
    api.post<{ added: { domain: string; name: string }[]; skipped: { domain: string; name: string; reason: string }[] }>(campaignUrl(ref, '/select'), input),
  draftAll: (ref: string) => api.post<{ drafted: number; skipped: { company: string; reason: string }[] }>(campaignUrl(ref, '/draft-all')),
  draft: (ref: string, input: { company: string; reason?: string; evidenceIds?: string[]; step?: number }) => api.post(campaignUrl(ref, '/drafts'), input),
  draftFollowUps: (ref: string) => api.post<{ drafted: number; skipped: { company: string; reason: string }[] }>(campaignUrl(ref, '/followups/draft')),
  dryRun: (ref: string) => api.post<DryRun>(campaignUrl(ref, '/send'), { dryRun: true }),
  send: (ref: string, confirm?: string) => api.post<SendJob>(campaignUrl(ref, '/send'), { dryRun: false, confirm }),
};

export const messageApi = {
  edit: (id: string, subject: string, body: string) => api.put(`/api/messages/${id}`, { subject, body }),
  approve: (id: string) => api.post(`/api/messages/${id}/approve`),
  cancel: (id: string, reason: string) => api.post(`/api/messages/${id}/cancel`, { reason }),
  retry: (id: string) => api.post(`/api/messages/${id}/retry`),
  resolve: (id: string, sent: boolean, note?: string) => api.post(`/api/messages/${id}/resolve`, { sent, note }),
};

export const prospectApi = {
  preview: (search: ProspectSearch) => api.post<DiscoverReport>('/api/prospect/preview', search),
  search: (search: ProspectSearch, funnel: ProspectFunnel) => api.post<ProspectJob>('/api/prospect/jobs', { mode: 'search', search, funnel }),
  pending: (funnel: ProspectFunnel, limit?: number) => api.post<ProspectJob>('/api/prospect/jobs', { mode: 'pending', funnel, limit }),
  retry: (domains: string[], funnel: ProspectFunnel) => api.post<ProspectJob>('/api/prospect/jobs', { mode: 'retry', domains, funnel }),
  stop: () => api.post<ProspectJob | null>('/api/prospect/job/stop'),
  qualify: (ref: string) => api.post<QualifyResult>(`/api/companies/${encodeURIComponent(ref)}/ai-qualify`),
  findContacts: (ref: string) => api.post<FindContactsReport>(`/api/companies/${encodeURIComponent(ref)}/find-contacts`, {}),
};

export type JobKind = 'leads.auto' | 'leads.enrich' | 'leads.qualify' | 'wa.run';

export const jobApi = {
  start: (kind: JobKind, confirm?: string) => api.post<Job>('/api/jobs', { kind, confirm }),
  stop: () => api.post<Job | null>('/api/job/stop'),
};

export const leadApi = {
  discover: (input: { city: string; state?: string; area?: string; limit?: number; dryRun: boolean }) => api.post<DiscoverLeadsReport>('/api/leads/discover', input),
};

export const whatsappApi = {
  draft: () => api.post<{ drafted: number; skipped: { name: string; reason: string }[] }>('/api/whatsapp/draft'),
  dryRun: () => api.post<WaDryRun>('/api/whatsapp/dry-run'),
  approve: (input: { ids?: string[]; all?: boolean }) => api.post<{ approved: number }>('/api/whatsapp/approve', input),
  edit: (id: string, body: string) => api.put(`/api/whatsapp/messages/${id}`, { body }),
  cancel: (id: string, reason: string) => api.post(`/api/whatsapp/messages/${id}/cancel`, { reason }),
  retry: (id: string) => api.post(`/api/whatsapp/messages/${id}/retry`),
  resolve: (id: string, sent: boolean) => api.post(`/api/whatsapp/messages/${id}/resolve`, { sent }),
  suppress: (phone: string, reason: string) => api.post<{ inserted: boolean }>('/api/whatsapp/suppress', { phone, reason }),
};

export const importApi = (kind: 'companies' | 'contacts', csv: string, dryRun: boolean) => api.post<ImportResult>(`/api/import/${kind}`, { csv, dryRun });

export type Resource<T> = { data?: T; error?: string; loading: boolean; reload: () => Promise<void> };

// Keeps the previous data while reloading, so screens do not flash empty after each action.
export const useApi = <T>(url: string | null): Resource<T> => {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: url !== null });
  const load = useCallback(async () => {
    if (url === null) return;
    setState((previous) => ({ ...previous, loading: true }));
    try {
      const data = await api.get<T>(url);
      setState({ data, loading: false });
    } catch (error) {
      setState((previous) => ({ data: previous.data, error: (error as Error).message, loading: false }));
    }
  }, [url]);
  useEffect(() => {
    void load();
  }, [load]);
  return { ...state, reload: load };
};
