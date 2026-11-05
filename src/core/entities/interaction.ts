export type InteractionType =
  | 'company_created'
  | 'company_updated'
  | 'status_changed'
  | 'contact_added'
  | 'contact_updated'
  | 'evidence_added'
  | 'qualification_evaluated'
  | 'next_action_set'
  | 'note_added'
  | 'campaign_target_added'
  | 'message_drafted'
  | 'message_approved'
  | 'message_cancelled'
  | 'message_sent'
  | 'message_failed'
  | 'message_unknown'
  | 'message_resolved'
  | 'reply_recorded'
  | 'reply_corrected'
  | 'suppressed'
  | 'personal_data_erased';

export type Interaction = {
  id: string;
  companyId: string;
  contactId?: string;
  type: InteractionType;
  summary: string;
  data?: Record<string, unknown>;
  occurredAt: string;
};
