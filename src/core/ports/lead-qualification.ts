import type { LeadSignal, LeadVerdict } from '../entities/lead.js';
import type { SitePage } from './qualification.js';

export type LeadQualifierInput = {
  lead: { name: string; city?: string; state?: string };
  // Who the ideal customer is and who to discard, written by the user in config/leads.json.
  profile: string;
  pages: SitePage[];
};

export type LeadQualifierVerdict = { verdict: LeadVerdict; reason: string; signals: Omit<LeadSignal, 'verified'>[] };

export interface LeadQualifier {
  readonly name: string;
  qualify(input: LeadQualifierInput): Promise<LeadQualifierVerdict>;
}
