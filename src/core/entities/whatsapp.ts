export const WA_MESSAGE_STATUSES = ['draft', 'approved', 'sending', 'sent', 'failed', 'unknown', 'cancelled'] as const;
export type WaMessageStatus = (typeof WA_MESSAGE_STATUSES)[number];

// The first WhatsApp message to a lead. One per lead: a refusal ends the conversation, so there is no follow-up sequence.
export type WaMessage = {
  id: string;
  leadId: string;
  // The number the message was approved for. If the lead's number changes afterwards, the message is not sent.
  toPhone: string;
  body: string;
  contentHash?: string;
  status: WaMessageStatus;
  providerMessageId?: string;
  error?: string;
  cancelReason?: string;
  approvedAt?: string;
  startedAt?: string;
  sentAt?: string;
  createdAt: string;
  updatedAt: string;
};
