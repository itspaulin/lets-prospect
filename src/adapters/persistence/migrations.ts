export const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE companies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        domain TEXT NOT NULL UNIQUE,
        website TEXT NOT NULL,
        country TEXT NOT NULL,
        region TEXT,
        segment TEXT,
        employee_count INTEGER,
        services TEXT,
        technologies_json TEXT NOT NULL DEFAULT '[]',
        source TEXT,
        last_verified_at TEXT,
        priority TEXT CHECK (priority IN ('high', 'medium', 'low')),
        status TEXT NOT NULL,
        disqualification_reason TEXT,
        next_action_at TEXT,
        next_action_note TEXT,
        notes TEXT,
        qualification_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX companies_status ON companies (status);
      CREATE INDEX companies_country ON companies (country);
      CREATE INDEX companies_next_action ON companies (next_action_at);

      CREATE TABLE contacts (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES companies (id),
        name TEXT NOT NULL,
        role TEXT,
        email TEXT UNIQUE,
        source TEXT,
        profile_url TEXT,
        identified_at TEXT NOT NULL,
        verification_status TEXT NOT NULL,
        do_not_contact INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX contacts_company ON contacts (company_id);
      CREATE UNIQUE INDEX contacts_company_name ON contacts (company_id, lower(name));

      CREATE TABLE evidences (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES companies (id),
        kind TEXT NOT NULL,
        claim TEXT NOT NULL,
        certainty TEXT NOT NULL CHECK (certainty IN ('verified', 'hypothesis')),
        stance TEXT NOT NULL CHECK (stance IN ('supports', 'contradicts')),
        source TEXT,
        observed_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        CHECK (certainty = 'hypothesis' OR source IS NOT NULL)
      );
      CREATE INDEX evidences_company ON evidences (company_id);

      CREATE TABLE interactions (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        company_id TEXT NOT NULL REFERENCES companies (id),
        contact_id TEXT REFERENCES contacts (id),
        type TEXT NOT NULL,
        summary TEXT NOT NULL,
        data_json TEXT,
        occurred_at TEXT NOT NULL
      );
      CREATE INDEX interactions_company ON interactions (company_id, seq);

      CREATE TRIGGER interactions_append_only_update BEFORE UPDATE ON interactions
        BEGIN SELECT RAISE(ABORT, 'interactions are append-only'); END;
      CREATE TRIGGER interactions_append_only_delete BEFORE DELETE ON interactions
        BEGIN SELECT RAISE(ABORT, 'interactions are append-only'); END;
    `,
  },
];

MIGRATIONS.push({
  version: 2,
  sql: `
    CREATE TABLE campaigns (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      criteria TEXT,
      market TEXT,
      segment TEXT,
      status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'paused', 'closed')),
      approved_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE templates (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns (id),
      step INTEGER NOT NULL,
      version INTEGER NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      approved_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (campaign_id, step, version)
    );
    CREATE TRIGGER templates_immutable_after_approval BEFORE UPDATE ON templates
      WHEN OLD.approved_at IS NOT NULL
      BEGIN SELECT RAISE(ABORT, 'approved templates are immutable'); END;

    CREATE TABLE campaign_targets (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns (id),
      company_id TEXT NOT NULL REFERENCES companies (id),
      contact_id TEXT NOT NULL REFERENCES contacts (id),
      added_at TEXT NOT NULL,
      UNIQUE (campaign_id, company_id)
    );
    CREATE INDEX campaign_targets_company ON campaign_targets (company_id);

    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns (id),
      company_id TEXT NOT NULL REFERENCES companies (id),
      contact_id TEXT NOT NULL REFERENCES contacts (id),
      template_id TEXT NOT NULL REFERENCES templates (id),
      step INTEGER NOT NULL,
      to_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      personalization TEXT NOT NULL CHECK (personalization IN ('evidence_based', 'generic')),
      evidence_ids TEXT NOT NULL DEFAULT '[]',
      content_hash TEXT,
      status TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'sending', 'sent', 'failed', 'unknown', 'cancelled')),
      header_message_id TEXT NOT NULL UNIQUE,
      provider_message_id TEXT,
      error TEXT,
      cancel_reason TEXT,
      approved_at TEXT,
      sent_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (campaign_id, contact_id, step),
      CHECK (status IN ('draft', 'cancelled') OR content_hash IS NOT NULL)
    );
    CREATE INDEX messages_status ON messages (status);
    CREATE INDEX messages_company ON messages (company_id);

    CREATE TABLE send_attempts (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES messages (id),
      campaign_id TEXT NOT NULL REFERENCES campaigns (id),
      started_at TEXT NOT NULL,
      finished_at TEXT,
      outcome TEXT NOT NULL CHECK (outcome IN ('sending', 'sent', 'failed', 'unknown')),
      provider_message_id TEXT,
      error TEXT
    );
    CREATE INDEX send_attempts_started ON send_attempts (started_at);

    CREATE TABLE suppressions (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('email', 'domain')),
      value_hash TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (kind, value_hash)
    );
    CREATE TRIGGER suppressions_permanent BEFORE DELETE ON suppressions
      BEGIN SELECT RAISE(ABORT, 'suppressions are permanent'); END;

    CREATE TABLE replies (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies (id),
      contact_id TEXT NOT NULL REFERENCES contacts (id),
      message_id TEXT REFERENCES messages (id),
      category TEXT NOT NULL,
      summary TEXT,
      received_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX replies_company ON replies (company_id);

    CREATE TABLE locks (
      name TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      acquired_at TEXT NOT NULL
    );

    DROP TRIGGER interactions_append_only_update;
    CREATE TRIGGER interactions_append_only_update BEFORE UPDATE ON interactions
      WHEN NOT (NEW.summary = '[dado pessoal removido]' AND NEW.data_json IS NULL
        AND NEW.id = OLD.id AND NEW.type = OLD.type AND NEW.occurred_at = OLD.occurred_at AND NEW.company_id = OLD.company_id)
      BEGIN SELECT RAISE(ABORT, 'interactions are append-only'); END;
  `,
});

MIGRATIONS.push({
  version: 3,
  sql: `
    CREATE TABLE prospect_runs (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL CHECK (mode IN ('search', 'pending', 'retry')),
      label TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('running', 'done', 'stopped', 'failed')),
      started_at TEXT NOT NULL,
      finished_at TEXT,
      read INTEGER NOT NULL DEFAULT 0,
      qualified INTEGER NOT NULL DEFAULT 0,
      review INTEGER NOT NULL DEFAULT 0,
      discarded INTEGER NOT NULL DEFAULT 0,
      credits_spent INTEGER NOT NULL DEFAULT 0,
      credit_cap INTEGER,
      error TEXT
    );
    CREATE INDEX prospect_runs_started ON prospect_runs (started_at);
  `,
});

MIGRATIONS.push({
  version: 4,
  sql: `
    CREATE TABLE leads (
      id TEXT PRIMARY KEY,
      place_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE,
      phone_kind TEXT NOT NULL CHECK (phone_kind IN ('mobile', 'landline')),
      website TEXT,
      address TEXT,
      city TEXT,
      state TEXT,
      rating REAL,
      review_count INTEGER,
      segment TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('identified', 'contacted', 'replied', 'interested', 'opportunity', 'converted', 'not_interested', 'do_not_contact')),
      source TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX leads_status ON leads (status);
  `,
});

MIGRATIONS.push({
  version: 5,
  sql: `
    ALTER TABLE leads ADD COLUMN whatsapp TEXT;
    ALTER TABLE leads ADD COLUMN whatsapp_source TEXT;
    ALTER TABLE leads ADD COLUMN enriched_at TEXT;
    ALTER TABLE leads ADD COLUMN enrichment_note TEXT;
  `,
});

MIGRATIONS.push({
  version: 6,
  sql: `
    CREATE TABLE wa_messages (
      id TEXT PRIMARY KEY,
      lead_id TEXT NOT NULL UNIQUE REFERENCES leads (id),
      to_phone TEXT NOT NULL,
      body TEXT NOT NULL,
      content_hash TEXT,
      status TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'sending', 'sent', 'failed', 'unknown', 'cancelled')),
      provider_message_id TEXT,
      error TEXT,
      cancel_reason TEXT,
      approved_at TEXT,
      started_at TEXT,
      sent_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (status IN ('draft', 'cancelled') OR content_hash IS NOT NULL)
    );
    CREATE INDEX wa_messages_status ON wa_messages (status);
    CREATE INDEX wa_messages_started ON wa_messages (started_at);

    -- The suppression list now also holds phone numbers. SQLite cannot change a CHECK, so the table is rebuilt.
    CREATE TABLE suppressions_new (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('email', 'domain', 'phone')),
      value_hash TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (kind, value_hash)
    );
    INSERT INTO suppressions_new (id, kind, value_hash, reason, created_at) SELECT id, kind, value_hash, reason, created_at FROM suppressions;
    DROP TRIGGER suppressions_permanent;
    DROP TABLE suppressions;
    ALTER TABLE suppressions_new RENAME TO suppressions;
    CREATE TRIGGER suppressions_permanent BEFORE DELETE ON suppressions
      BEGIN SELECT RAISE(ABORT, 'suppressions are permanent'); END;
  `,
});

MIGRATIONS.push({
  version: 7,
  sql: `
    ALTER TABLE leads ADD COLUMN qualification TEXT;
    ALTER TABLE leads ADD COLUMN qualified_at TEXT;

    CREATE TABLE lead_searches (
      id TEXT PRIMARY KEY,
      query TEXT NOT NULL,
      ran_at TEXT NOT NULL,
      found INTEGER NOT NULL,
      imported INTEGER NOT NULL,
      requests INTEGER NOT NULL
    );
    CREATE INDEX lead_searches_ran ON lead_searches (ran_at);
  `,
});
