export const CAMPAIGN_STATUSES = ['draft', 'active', 'paused', 'closed'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export type Campaign = {
  id: string;
  name: string;
  criteria?: string;
  market?: string;
  segment?: string;
  status: CampaignStatus;
  approvedAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

export type Template = {
  id: string;
  campaignId: string;
  step: number;
  version: number;
  subject: string;
  body: string;
  approvedAt?: string;
  createdAt: string;
};

export type CampaignTarget = {
  id: string;
  campaignId: string;
  companyId: string;
  contactId: string;
  addedAt: string;
};

export const MESSAGE_STATUSES = ['draft', 'approved', 'sending', 'sent', 'failed', 'unknown', 'cancelled'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];
export type Personalization = 'evidence_based' | 'generic';

export type Message = {
  id: string;
  campaignId: string;
  companyId: string;
  contactId: string;
  templateId: string;
  step: number;
  toEmail: string;
  subject: string;
  body: string;
  personalization: Personalization;
  evidenceIds: string[];
  contentHash?: string;
  status: MessageStatus;
  headerMessageId: string;
  providerMessageId?: string;
  error?: string;
  cancelReason?: string;
  approvedAt?: string;
  sentAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type AttemptOutcome = 'sending' | 'sent' | 'failed' | 'unknown';

export type SendAttempt = {
  id: string;
  messageId: string;
  campaignId: string;
  startedAt: string;
  finishedAt?: string;
  outcome: AttemptOutcome;
  providerMessageId?: string;
  error?: string;
};

export type Suppression = {
  id: string;
  kind: 'email' | 'domain' | 'phone';
  valueHash: string;
  reason: string;
  createdAt: string;
};

export const REPLY_CATEGORIES = [
  'interested_to_talk',
  'future_collaboration',
  'more_info',
  'cv_or_portfolio',
  'no_need_now',
  'declined',
  'referral',
  'auto_reply',
  'invalid_address',
  'unsubscribe',
  'inconclusive',
] as const;
export type ReplyCategory = (typeof REPLY_CATEGORIES)[number];

export type Reply = {
  id: string;
  companyId: string;
  contactId: string;
  messageId?: string;
  category: ReplyCategory;
  summary?: string;
  receivedAt: string;
  createdAt: string;
  updatedAt: string;
};
