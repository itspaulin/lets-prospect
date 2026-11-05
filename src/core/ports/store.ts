import type { Company, CompanyStatus, Priority } from '../entities/company.js';
import type { Contact } from '../entities/contact.js';
import type { Evidence } from '../entities/evidence.js';
import type { Interaction } from '../entities/interaction.js';
import type { Lead, LeadStatus } from '../entities/lead.js';
import type { WaMessage, WaMessageStatus } from '../entities/whatsapp.js';
import type { ProspectRun } from '../entities/prospect-run.js';
import type { OutreachStore } from './outreach-store.js';

export type CompanyFilter = {
  statuses?: CompanyStatus[];
  countries?: string[];
  technology?: string;
  priority?: Priority;
  minEmployees?: number;
  maxEmployees?: number;
  hasContacts?: boolean;
  nextActionDueBy?: string;
  lastInteractionBefore?: string;
  lastInteractionAfter?: string;
  disqualificationReason?: string;
};

export type CompanyListItem = Company & { contactCount: number; lastInteractionAt?: string };

export interface CompanyRepository {
  insert(company: Company): void;
  update(company: Company): void;
  findById(id: string): Company | null;
  findByDomain(domain: string): Company | null;
  list(filter: CompanyFilter): CompanyListItem[];
  all(): Company[];
}

export interface ContactRepository {
  insert(contact: Contact): void;
  all(): Contact[];
  update(contact: Contact): void;
  findById(id: string): Contact | null;
  findByEmail(email: string): Contact | null;
  findByCompanyAndName(companyId: string, name: string): Contact | null;
  listByCompany(companyId: string): Contact[];
}

export interface EvidenceRepository {
  insert(evidence: Evidence): void;
  listByCompany(companyId: string): Evidence[];
}

export interface InteractionRepository {
  insert(interaction: Interaction): void;
  listByCompany(companyId: string): Interaction[];
  redactContact(contactId: string, redacted: string): void;
}

export interface ProspectRunRepository {
  insert(run: ProspectRun): void;
  update(run: ProspectRun): void;
  recent(limit: number): ProspectRun[];
  // A run still "running" when the server starts was cut short; it must not look alive forever.
  closeAbandoned(finishedAt: string): void;
}

export type LeadFilter = { statuses?: LeadStatus[]; city?: string };

export interface LeadRepository {
  insert(lead: Lead): void;
  update(lead: Lead): void;
  findById(id: string): Lead | null;
  findByPlaceId(placeId: string): Lead | null;
  findByPhone(phone: string): Lead | null;
  list(filter?: LeadFilter): Lead[];
}

export type LeadSearch = { id: string; query: string; ranAt: string; found: number; imported: number; requests: number };

export interface LeadSearchRepository {
  insert(search: LeadSearch): void;
  // When this exact search last ran, if ever.
  lastRan(query: string): string | undefined;
  requestsSince(iso: string): number;
}

export interface WaMessageRepository {
  insert(message: WaMessage): void;
  update(message: WaMessage): void;
  findById(id: string): WaMessage | null;
  findByLead(leadId: string): WaMessage | null;
  // approved -> sending, stamping the start time. False when someone else got it first.
  claim(id: string, now: string): boolean;
  list(filter?: { statuses?: WaMessageStatus[] }): WaMessage[];
  countStartedSince(iso: string): number;
}

export interface Store extends OutreachStore {
  leads: LeadRepository;
  waMessages: WaMessageRepository;
  leadSearches: LeadSearchRepository;
  prospectRuns: ProspectRunRepository;
  companies: CompanyRepository;
  contacts: ContactRepository;
  evidences: EvidenceRepository;
  interactions: InteractionRepository;
  transaction<T>(work: () => T): T;
}
