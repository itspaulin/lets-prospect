import type { Campaign, CampaignTarget, Message, MessageStatus, Reply, SendAttempt, Suppression, Template } from '../entities/outreach.js';

export interface CampaignRepository {
  insert(campaign: Campaign): void;
  update(campaign: Campaign): void;
  findById(id: string): Campaign | null;
  findByName(name: string): Campaign | null;
  all(): Campaign[];
}

export interface TemplateRepository {
  insert(template: Template): void;
  update(template: Template): void;
  findById(id: string): Template | null;
  latest(campaignId: string, step: number): Template | null;
  listByCampaign(campaignId: string): Template[];
}

export interface TargetRepository {
  insert(target: CampaignTarget): void;
  listByCampaign(campaignId: string): CampaignTarget[];
  listByCompany(companyId: string): CampaignTarget[];
}

export interface MessageRepository {
  insert(message: Message): void;
  update(message: Message): void;
  findById(id: string): Message | null;
  find(campaignId: string, contactId: string, step: number): Message | null;
  claim(id: string, updatedAt: string): boolean;
  list(filter: { campaignId?: string; statuses?: MessageStatus[]; contactId?: string; companyId?: string }): Message[];
}

export interface AttemptRepository {
  insert(attempt: SendAttempt): void;
  update(attempt: SendAttempt): void;
  countStartedSince(iso: string): number;
  listByMessage(messageId: string): SendAttempt[];
  all(): SendAttempt[];
}

export interface SuppressionRepository {
  insert(suppression: Suppression): boolean;
  has(kind: Suppression['kind'], valueHash: string): boolean;
  all(): Suppression[];
}

export interface ReplyRepository {
  insert(reply: Reply): void;
  update(reply: Reply): void;
  findById(id: string): Reply | null;
  list(filter: { companyId?: string; contactId?: string }): Reply[];
}

export interface LockRepository {
  acquire(name: string, owner: string, now: string, staleBefore: string): boolean;
  release(name: string, owner: string): void;
}

export interface OutreachStore {
  campaigns: CampaignRepository;
  templates: TemplateRepository;
  targets: TargetRepository;
  messages: MessageRepository;
  attempts: AttemptRepository;
  suppressions: SuppressionRepository;
  replies: ReplyRepository;
  locks: LockRepository;
}
