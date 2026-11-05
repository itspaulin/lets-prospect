export const LEAD_STATUSES = ['identified', 'contacted', 'replied', 'interested', 'opportunity', 'converted', 'not_interested', 'do_not_contact'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export type PhoneKind = 'mobile' | 'landline';

export type LeadVerdict = 'fit' | 'not_a_fit' | 'unclear';

// activity: what the business does. need: a sign that automation would help it. contradiction: evidence it is not a fit.
// A signal is "verified" only when its quote is really on the page it points to and reads as a sentence.
export type LeadSignal = { kind: 'activity' | 'need' | 'contradiction'; claim: string; quote: string; pageUrl: string; verified: boolean };

export type LeadQualification = { verdict: LeadVerdict; reason: string; signals: LeadSignal[]; model: string };

// A local business found by phone (Google Places), the WhatsApp counterpart of Company. It has no domain
// or e-mail requirement: many real estate agencies only have a phone and a profile on a portal.
export type Lead = {
  id: string;
  placeId: string;
  name: string;
  // E.164 with the country code, for example +5531999998888. Unique: one number, one lead.
  phone: string;
  phoneKind: PhoneKind;
  website?: string;
  address?: string;
  city?: string;
  state?: string;
  rating?: number;
  reviewCount?: number;
  // The number to message, when we found one. Comes from the company's own site (whatsappSource is the page) or,
  // failing that, from a mobile number listed on Google. Landline-only leads stay without it.
  whatsapp?: string;
  whatsappSource?: string;
  enrichedAt?: string;
  // Why no WhatsApp was found (site blocked, no link, no site), for the person reviewing.
  enrichmentNote?: string;
  // The AI's judgement of the site. Only a verdict of 'fit' lets the lead be contacted. qualifiedAt is set only
  // when the model really judged: a site that could not be read leaves it empty so the next run tries again.
  qualification?: LeadQualification;
  qualifiedAt?: string;
  segment: string;
  status: LeadStatus;
  source: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};
