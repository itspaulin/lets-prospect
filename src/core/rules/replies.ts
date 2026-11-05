import type { ReplyCategory } from '../entities/outreach.js';

export type ReplyEffect = {
  countsAsResponse: boolean;
  interest: boolean;
  stopsSequence: boolean;
  suppressContact: boolean;
  invalidContact: boolean;
  companyStatus?: 'not_interested' | 'do_not_contact';
};

const base: ReplyEffect = { countsAsResponse: true, interest: false, stopsSequence: true, suppressContact: false, invalidContact: false };

// An out-of-office reply or a bounce is not a human answer: it neither counts as a response nor stops
// follow-ups by itself (a bounce stops them by invalidating the address instead).
export const REPLY_EFFECTS: Record<ReplyCategory, ReplyEffect> = {
  interested_to_talk: { ...base, interest: true },
  future_collaboration: { ...base, interest: true },
  more_info: { ...base, interest: true },
  cv_or_portfolio: { ...base, interest: true },
  no_need_now: { ...base },
  declined: { ...base, companyStatus: 'not_interested' },
  referral: { ...base },
  auto_reply: { ...base, countsAsResponse: false, stopsSequence: false },
  invalid_address: { ...base, countsAsResponse: false, suppressContact: true, invalidContact: true },
  unsubscribe: { ...base, suppressContact: true, companyStatus: 'do_not_contact' },
  inconclusive: { ...base },
};

export const RESPONSE_CATEGORIES = (Object.keys(REPLY_EFFECTS) as ReplyCategory[]).filter((category) => REPLY_EFFECTS[category].countsAsResponse);
export const INTEREST_CATEGORIES = (Object.keys(REPLY_EFFECTS) as ReplyCategory[]).filter((category) => REPLY_EFFECTS[category].interest);
