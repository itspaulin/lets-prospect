import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Company } from '../../core/entities/company.js';
import type { Contact } from '../../core/entities/contact.js';
import type { Evidence } from '../../core/entities/evidence.js';
import type { Interaction } from '../../core/entities/interaction.js';
import type {
  CompanyFilter,
  CompanyListItem,
  CompanyRepository,
  ContactRepository,
  EvidenceRepository,
  InteractionRepository,
  Store,
} from '../../core/ports/store.js';
import { MIGRATIONS } from './migrations.js';
import { createOutreachStore } from './outreach-store.js';
import { Table } from './table.js';
import type { Lead } from '../../core/entities/lead.js';
import type { WaMessage } from '../../core/entities/whatsapp.js';
import type { LeadSearch } from '../../core/ports/store.js';
import type { ProspectRun } from '../../core/entities/prospect-run.js';

type Row = Record<string, unknown>;

const opt = <T>(value: unknown): T | undefined => (value === null || value === undefined ? undefined : (value as T));
const nul = (value: unknown): unknown => (value === undefined ? null : value);

export const openDatabase = (path: string): Database.Database => {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
};

export const migrate = (db: Database.Database): void => {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set((db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((row) => row.version));
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(migration.version, new Date().toISOString());
    })();
  }
};

const companyParams = (company: Company) => ({
  id: company.id,
  name: company.name,
  domain: company.domain,
  website: company.website,
  country: company.country,
  region: nul(company.region),
  segment: nul(company.segment),
  employeeCount: nul(company.employeeCount),
  services: nul(company.services),
  technologiesJson: JSON.stringify(company.technologies),
  source: nul(company.source),
  lastVerifiedAt: nul(company.lastVerifiedAt),
  priority: nul(company.priority),
  status: company.status,
  disqualificationReason: nul(company.disqualificationReason),
  nextActionAt: nul(company.nextActionAt),
  nextActionNote: nul(company.nextActionNote),
  notes: nul(company.notes),
  qualificationJson: company.qualification ? JSON.stringify(company.qualification) : null,
  createdAt: company.createdAt,
  updatedAt: company.updatedAt,
});

const toCompany = (row: Row): Company => ({
  id: row.id as string,
  name: row.name as string,
  domain: row.domain as string,
  website: row.website as string,
  country: row.country as string,
  region: opt(row.region),
  segment: opt(row.segment),
  employeeCount: opt(row.employee_count),
  services: opt(row.services),
  technologies: JSON.parse(row.technologies_json as string) as string[],
  source: opt(row.source),
  lastVerifiedAt: opt(row.last_verified_at),
  priority: opt(row.priority),
  status: row.status as Company['status'],
  disqualificationReason: opt(row.disqualification_reason),
  nextActionAt: opt(row.next_action_at),
  nextActionNote: opt(row.next_action_note),
  notes: opt(row.notes),
  qualification: row.qualification_json ? JSON.parse(row.qualification_json as string) : undefined,
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
});

class SqliteCompanies implements CompanyRepository {
  constructor(private readonly db: Database.Database) {}

  insert(company: Company): void {
    this.db
      .prepare(
        `INSERT INTO companies (id, name, domain, website, country, region, segment, employee_count, services, technologies_json, source,
          last_verified_at, priority, status, disqualification_reason, next_action_at, next_action_note, notes, qualification_json, created_at, updated_at)
        VALUES (@id, @name, @domain, @website, @country, @region, @segment, @employeeCount, @services, @technologiesJson, @source,
          @lastVerifiedAt, @priority, @status, @disqualificationReason, @nextActionAt, @nextActionNote, @notes, @qualificationJson, @createdAt, @updatedAt)`,
      )
      .run(companyParams(company));
  }

  update(company: Company): void {
    this.db
      .prepare(
        `UPDATE companies SET name = @name, domain = @domain, website = @website, country = @country, region = @region, segment = @segment,
          employee_count = @employeeCount, services = @services, technologies_json = @technologiesJson, source = @source,
          last_verified_at = @lastVerifiedAt, priority = @priority, status = @status, disqualification_reason = @disqualificationReason,
          next_action_at = @nextActionAt, next_action_note = @nextActionNote, notes = @notes, qualification_json = @qualificationJson,
          updated_at = @updatedAt
        WHERE id = @id`,
      )
      .run(companyParams(company));
  }

  findById(id: string): Company | null {
    const row = this.db.prepare('SELECT * FROM companies WHERE id = ?').get(id) as Row | undefined;
    return row ? toCompany(row) : null;
  }

  findByDomain(domain: string): Company | null {
    const row = this.db.prepare('SELECT * FROM companies WHERE domain = ?').get(domain) as Row | undefined;
    return row ? toCompany(row) : null;
  }

  all(): Company[] {
    return (this.db.prepare('SELECT * FROM companies ORDER BY created_at').all() as Row[]).map(toCompany);
  }

  list(filter: CompanyFilter): CompanyListItem[] {
    const where: string[] = [];
    const params: unknown[] = [];
    const inList = (column: string, values: string[]) => {
      where.push(`${column} IN (${values.map(() => '?').join(', ')})`);
      params.push(...values);
    };
    if (filter.statuses?.length) inList('c.status', filter.statuses);
    if (filter.countries?.length) inList('c.country', filter.countries);
    if (filter.priority) (where.push('c.priority = ?'), params.push(filter.priority));
    if (filter.technology)
      (where.push('EXISTS (SELECT 1 FROM json_each(c.technologies_json) WHERE lower(value) = lower(?))'), params.push(filter.technology));
    if (filter.minEmployees !== undefined) (where.push('c.employee_count >= ?'), params.push(filter.minEmployees));
    if (filter.maxEmployees !== undefined) (where.push('c.employee_count <= ?'), params.push(filter.maxEmployees));
    if (filter.hasContacts !== undefined) where.push(filter.hasContacts ? 'contact_count > 0' : 'contact_count = 0');
    if (filter.nextActionDueBy) (where.push('c.next_action_at IS NOT NULL AND c.next_action_at <= ?'), params.push(filter.nextActionDueBy));
    if (filter.lastInteractionBefore) (where.push('last_interaction_at < ?'), params.push(filter.lastInteractionBefore));
    if (filter.lastInteractionAfter) (where.push('last_interaction_at >= ?'), params.push(filter.lastInteractionAfter));
    if (filter.disqualificationReason)
      (where.push("lower(c.disqualification_reason) LIKE '%' || lower(?) || '%'"), params.push(filter.disqualificationReason));

    const sql = `SELECT * FROM (
        SELECT c.*,
          (SELECT COUNT(*) FROM contacts ct WHERE ct.company_id = c.id) AS contact_count,
          (SELECT MAX(i.occurred_at) FROM interactions i WHERE i.company_id = c.id) AS last_interaction_at
        FROM companies c
      ) c
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY CASE c.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END, c.next_action_at IS NULL, c.next_action_at, c.name`;
    return (this.db.prepare(sql).all(...params) as Row[]).map((row) => ({
      ...toCompany(row),
      contactCount: row.contact_count as number,
      lastInteractionAt: opt(row.last_interaction_at),
    }));
  }
}

const contactParams = (contact: Contact) => ({
  id: contact.id,
  companyId: contact.companyId,
  name: contact.name,
  role: nul(contact.role),
  email: nul(contact.email),
  source: nul(contact.source),
  profileUrl: nul(contact.profileUrl),
  identifiedAt: contact.identifiedAt,
  verificationStatus: contact.verificationStatus,
  doNotContact: contact.doNotContact ? 1 : 0,
  notes: nul(contact.notes),
  createdAt: contact.createdAt,
  updatedAt: contact.updatedAt,
});

const toContact = (row: Row): Contact => ({
  id: row.id as string,
  companyId: row.company_id as string,
  name: row.name as string,
  role: opt(row.role),
  email: opt(row.email),
  source: opt(row.source),
  profileUrl: opt(row.profile_url),
  identifiedAt: row.identified_at as string,
  verificationStatus: row.verification_status as Contact['verificationStatus'],
  doNotContact: row.do_not_contact === 1,
  notes: opt(row.notes),
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
});

class SqliteContacts implements ContactRepository {
  constructor(private readonly db: Database.Database) {}

  insert(contact: Contact): void {
    this.db
      .prepare(
        `INSERT INTO contacts (id, company_id, name, role, email, source, profile_url, identified_at, verification_status, do_not_contact, notes, created_at, updated_at)
        VALUES (@id, @companyId, @name, @role, @email, @source, @profileUrl, @identifiedAt, @verificationStatus, @doNotContact, @notes, @createdAt, @updatedAt)`,
      )
      .run(contactParams(contact));
  }

  update(contact: Contact): void {
    this.db
      .prepare(
        `UPDATE contacts SET name = @name, role = @role, email = @email, source = @source, profile_url = @profileUrl,
          verification_status = @verificationStatus, do_not_contact = @doNotContact, notes = @notes, updated_at = @updatedAt
        WHERE id = @id`,
      )
      .run(contactParams(contact));
  }

  all(): Contact[] {
    return (this.db.prepare('SELECT * FROM contacts ORDER BY created_at').all() as Row[]).map(toContact);
  }

  findById(id: string): Contact | null {
    const row = this.db.prepare('SELECT * FROM contacts WHERE id = ?').get(id) as Row | undefined;
    return row ? toContact(row) : null;
  }

  findByEmail(email: string): Contact | null {
    const row = this.db.prepare('SELECT * FROM contacts WHERE email = ?').get(email) as Row | undefined;
    return row ? toContact(row) : null;
  }

  findByCompanyAndName(companyId: string, name: string): Contact | null {
    const row = this.db.prepare('SELECT * FROM contacts WHERE company_id = ? AND lower(name) = lower(?)').get(companyId, name.trim()) as Row | undefined;
    return row ? toContact(row) : null;
  }

  listByCompany(companyId: string): Contact[] {
    return (this.db.prepare('SELECT * FROM contacts WHERE company_id = ? ORDER BY created_at').all(companyId) as Row[]).map(toContact);
  }
}

class SqliteEvidences implements EvidenceRepository {
  constructor(private readonly db: Database.Database) {}

  insert(evidence: Evidence): void {
    this.db
      .prepare(
        `INSERT INTO evidences (id, company_id, kind, claim, certainty, stance, source, observed_at, created_at)
        VALUES (@id, @companyId, @kind, @claim, @certainty, @stance, @source, @observedAt, @createdAt)`,
      )
      .run({ ...evidence, source: nul(evidence.source) });
  }

  listByCompany(companyId: string): Evidence[] {
    return (this.db.prepare('SELECT * FROM evidences WHERE company_id = ? ORDER BY created_at').all(companyId) as Row[]).map((row) => ({
      id: row.id as string,
      companyId: row.company_id as string,
      kind: row.kind as Evidence['kind'],
      claim: row.claim as string,
      certainty: row.certainty as Evidence['certainty'],
      stance: row.stance as Evidence['stance'],
      source: opt(row.source),
      observedAt: row.observed_at as string,
      createdAt: row.created_at as string,
    }));
  }
}

class SqliteInteractions implements InteractionRepository {
  constructor(private readonly db: Database.Database) {}

  insert(interaction: Interaction): void {
    this.db
      .prepare(
        `INSERT INTO interactions (id, company_id, contact_id, type, summary, data_json, occurred_at)
        VALUES (@id, @companyId, @contactId, @type, @summary, @dataJson, @occurredAt)`,
      )
      .run({
        id: interaction.id,
        companyId: interaction.companyId,
        contactId: nul(interaction.contactId),
        type: interaction.type,
        summary: interaction.summary,
        dataJson: interaction.data ? JSON.stringify(interaction.data) : null,
        occurredAt: interaction.occurredAt,
      });
  }

  redactContact(contactId: string, redacted: string): void {
    this.db.prepare('UPDATE interactions SET summary = ?, data_json = NULL WHERE contact_id = ?').run(redacted, contactId);
  }

  listByCompany(companyId: string): Interaction[] {
    return (this.db.prepare('SELECT * FROM interactions WHERE company_id = ? ORDER BY seq').all(companyId) as Row[]).map((row) => ({
      id: row.id as string,
      companyId: row.company_id as string,
      contactId: opt(row.contact_id),
      type: row.type as Interaction['type'],
      summary: row.summary as string,
      data: row.data_json ? JSON.parse(row.data_json as string) : undefined,
      occurredAt: row.occurred_at as string,
    }));
  }
}

const createProspectRuns = (db: Database.Database): Store['prospectRuns'] => {
  const runs = new Table<ProspectRun>(db, 'prospect_runs', {
    columns: ['id', 'mode', 'label', 'status', 'startedAt', 'finishedAt', 'read', 'qualified', 'review', 'discarded', 'creditsSpent', 'creditCap', 'error'],
  });
  return {
    insert: (run) => void runs.insert(run),
    update: (run) => runs.update(run),
    recent: (limit) => runs.many('1 = 1 ORDER BY started_at DESC LIMIT ?', limit),
    closeAbandoned: (finishedAt) =>
      void db.prepare("UPDATE prospect_runs SET status = 'failed', finished_at = ?, error = 'interrompida: o servidor reiniciou' WHERE status = 'running'").run(finishedAt),
  };
};

const createLeads = (db: Database.Database): Store['leads'] => {
  const leads = new Table<Lead>(db, 'leads', {
    columns: ['id', 'placeId', 'name', 'phone', 'phoneKind', 'website', 'address', 'city', 'state', 'rating', 'reviewCount', 'whatsapp', 'whatsappSource', 'enrichedAt', 'enrichmentNote', 'qualification', 'qualifiedAt', 'segment', 'status', 'source', 'notes', 'createdAt', 'updatedAt'],
    json: ['qualification'],
  });
  return {
    insert: (lead) => void leads.insert(lead),
    update: (lead) => leads.update(lead),
    findById: (id) => leads.one('id = ?', id),
    findByPlaceId: (placeId) => leads.one('place_id = ?', placeId),
    findByPhone: (phone) => leads.one('phone = ?', phone),
    list: (filter = {}) => {
      const where: string[] = [];
      const params: unknown[] = [];
      if (filter.statuses?.length) (where.push(`status IN (${filter.statuses.map(() => '?').join(', ')})`), params.push(...filter.statuses));
      if (filter.city) (where.push('lower(city) = lower(?)'), params.push(filter.city));
      return leads.many(`${where.length ? where.join(' AND ') : '1 = 1'} ORDER BY created_at, name`, ...params);
    },
  };
};

const createWaMessages = (db: Database.Database): Store['waMessages'] => {
  const messages = new Table<WaMessage>(db, 'wa_messages', {
    columns: ['id', 'leadId', 'toPhone', 'body', 'contentHash', 'status', 'providerMessageId', 'error', 'cancelReason', 'approvedAt', 'startedAt', 'sentAt', 'createdAt', 'updatedAt'],
  });
  return {
    insert: (message) => void messages.insert(message),
    update: (message) => messages.update(message),
    findById: (id) => messages.one('id = ?', id),
    findByLead: (leadId) => messages.one('lead_id = ?', leadId),
    claim: (id, now) => db.prepare("UPDATE wa_messages SET status = 'sending', started_at = ?, updated_at = ? WHERE id = ? AND status = 'approved'").run(now, now, id).changes === 1,
    list: (filter = {}) =>
      messages.many(`${filter.statuses?.length ? `status IN (${filter.statuses.map(() => '?').join(', ')})` : '1 = 1'} ORDER BY created_at, rowid`, ...(filter.statuses ?? [])),
    countStartedSince: (iso) => (db.prepare('SELECT COUNT(*) AS n FROM wa_messages WHERE started_at >= ?').get(iso) as { n: number }).n,
  };
};

const createLeadSearches = (db: Database.Database): Store['leadSearches'] => {
  const searches = new Table<LeadSearch>(db, 'lead_searches', { columns: ['id', 'query', 'ranAt', 'found', 'imported', 'requests'] });
  return {
    insert: (search) => void searches.insert(search),
    lastRan: (query) => (db.prepare('SELECT MAX(ran_at) AS at FROM lead_searches WHERE query = ?').get(query) as { at: string | null }).at ?? undefined,
    requestsSince: (iso) => (db.prepare('SELECT COALESCE(SUM(requests), 0) AS n FROM lead_searches WHERE ran_at >= ?').get(iso) as { n: number }).n,
  };
};

export const createSqliteStore = (db: Database.Database): Store => ({
  ...createOutreachStore(db),
  leads: createLeads(db),
  waMessages: createWaMessages(db),
  leadSearches: createLeadSearches(db),
  prospectRuns: createProspectRuns(db),
  companies: new SqliteCompanies(db),
  contacts: new SqliteContacts(db),
  evidences: new SqliteEvidences(db),
  interactions: new SqliteInteractions(db),
  transaction: <T>(work: () => T): T => db.transaction(work)(),
});
