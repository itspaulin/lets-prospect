import type Database from 'better-sqlite3';
import type { Campaign, CampaignTarget, Message, Reply, SendAttempt, Suppression, Template } from '../../core/entities/outreach.js';
import type { OutreachStore } from '../../core/ports/outreach-store.js';
import { Table } from './table.js';

export const createOutreachStore = (db: Database.Database): OutreachStore => {
  const campaigns = new Table<Campaign>(db, 'campaigns', {
    columns: ['id', 'name', 'criteria', 'market', 'segment', 'status', 'approvedAt', 'notes', 'createdAt', 'updatedAt'],
  });
  const templates = new Table<Template>(db, 'templates', {
    columns: ['id', 'campaignId', 'step', 'version', 'subject', 'body', 'approvedAt', 'createdAt'],
  });
  const targets = new Table<CampaignTarget>(db, 'campaign_targets', { columns: ['id', 'campaignId', 'companyId', 'contactId', 'addedAt'] });
  const messages = new Table<Message>(db, 'messages', {
    columns: [
      'id', 'campaignId', 'companyId', 'contactId', 'templateId', 'step', 'toEmail', 'subject', 'body', 'personalization', 'evidenceIds',
      'contentHash', 'status', 'headerMessageId', 'providerMessageId', 'error', 'cancelReason', 'approvedAt', 'sentAt', 'createdAt', 'updatedAt',
    ],
    json: ['evidenceIds'],
  });
  const attempts = new Table<SendAttempt>(db, 'send_attempts', {
    columns: ['id', 'messageId', 'campaignId', 'startedAt', 'finishedAt', 'outcome', 'providerMessageId', 'error'],
  });
  const suppressions = new Table<Suppression>(db, 'suppressions', { columns: ['id', 'kind', 'valueHash', 'reason', 'createdAt'] });
  const replies = new Table<Reply>(db, 'replies', {
    columns: ['id', 'companyId', 'contactId', 'messageId', 'category', 'summary', 'receivedAt', 'createdAt', 'updatedAt'],
  });

  return {
    campaigns: {
      insert: (campaign) => void campaigns.insert(campaign),
      update: (campaign) => campaigns.update(campaign),
      findById: (id) => campaigns.one('id = ?', id),
      findByName: (name) => campaigns.one('lower(name) = lower(?)', name.trim()),
      all: () => campaigns.many('1 = 1 ORDER BY created_at'),
    },
    templates: {
      insert: (template) => void templates.insert(template),
      update: (template) => templates.update(template),
      findById: (id) => templates.one('id = ?', id),
      latest: (campaignId, step) => templates.one('campaign_id = ? AND step = ? ORDER BY version DESC LIMIT 1', campaignId, step),
      listByCampaign: (campaignId) => templates.many('campaign_id = ? ORDER BY step, version', campaignId),
    },
    targets: {
      insert: (target) => void targets.insert(target),
      listByCampaign: (campaignId) => targets.many('campaign_id = ? ORDER BY added_at, rowid', campaignId),
      listByCompany: (companyId) => targets.many('company_id = ? ORDER BY added_at', companyId),
    },
    messages: {
      insert: (message) => void messages.insert(message),
      update: (message) => messages.update(message),
      findById: (id) => messages.one('id = ?', id),
      find: (campaignId, contactId, step) => messages.one('campaign_id = ? AND contact_id = ? AND step = ?', campaignId, contactId, step),
      claim: (id, updatedAt) =>
        db.prepare("UPDATE messages SET status = 'sending', updated_at = ? WHERE id = ? AND status = 'approved'").run(updatedAt, id).changes === 1,
      list: (filter) => {
        const where = ['1 = 1'];
        const params: unknown[] = [];
        if (filter.campaignId) (where.push('campaign_id = ?'), params.push(filter.campaignId));
        if (filter.contactId) (where.push('contact_id = ?'), params.push(filter.contactId));
        if (filter.companyId) (where.push('company_id = ?'), params.push(filter.companyId));
        if (filter.statuses?.length) (where.push(`status IN (${filter.statuses.map(() => '?').join(', ')})`), params.push(...filter.statuses));
        return messages.many(`${where.join(' AND ')} ORDER BY created_at, rowid`, ...params);
      },
    },
    attempts: {
      insert: (attempt) => void attempts.insert(attempt),
      update: (attempt) => attempts.update(attempt),
      countStartedSince: (iso) => (db.prepare('SELECT COUNT(*) AS n FROM send_attempts WHERE started_at >= ?').get(iso) as { n: number }).n,
      listByMessage: (messageId) => attempts.many('message_id = ? ORDER BY started_at', messageId),
      all: () => attempts.many('1 = 1 ORDER BY started_at'),
    },
    suppressions: {
      insert: (suppression) => db.prepare('INSERT OR IGNORE INTO suppressions (id, kind, value_hash, reason, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(suppression.id, suppression.kind, suppression.valueHash, suppression.reason, suppression.createdAt).changes === 1,
      has: (kind, valueHash) => suppressions.one('kind = ? AND value_hash = ?', kind, valueHash) !== null,
      all: () => suppressions.many('1 = 1 ORDER BY created_at'),
    },
    replies: {
      insert: (reply) => void replies.insert(reply),
      update: (reply) => replies.update(reply),
      findById: (id) => replies.one('id = ?', id),
      list: (filter) => {
        if (filter.contactId) return replies.many('contact_id = ? ORDER BY received_at, rowid', filter.contactId);
        if (filter.companyId) return replies.many('company_id = ? ORDER BY received_at, rowid', filter.companyId);
        return replies.many('1 = 1 ORDER BY received_at, rowid');
      },
    },
    locks: {
      acquire: (name, owner, now, staleBefore) =>
        db.transaction(() => {
          db.prepare('DELETE FROM locks WHERE name = ? AND acquired_at < ?').run(name, staleBefore);
          return db.prepare('INSERT OR IGNORE INTO locks (name, owner, acquired_at) VALUES (?, ?, ?)').run(name, owner, now).changes === 1;
        })(),
      release: (name, owner) => void db.prepare('DELETE FROM locks WHERE name = ? AND owner = ?').run(name, owner),
    },
  };
};
