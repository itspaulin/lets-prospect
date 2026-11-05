import type { QualificationResult } from './qualification.js';

export const COMPANY_STATUSES = [
  'identified',
  'qualified',
  'disqualified',
  'contacted',
  'replied',
  'interested',
  'opportunity',
  'converted',
  'not_interested',
  'do_not_contact',
  'inactive',
] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

export const PRIORITIES = ['high', 'medium', 'low'] as const;
export type Priority = (typeof PRIORITIES)[number];

export type Company = {
  id: string;
  name: string;
  domain: string;
  website: string;
  country: string;
  region?: string;
  segment?: string;
  employeeCount?: number;
  services?: string;
  technologies: string[];
  source?: string;
  lastVerifiedAt?: string;
  priority?: Priority;
  status: CompanyStatus;
  disqualificationReason?: string;
  nextActionAt?: string;
  nextActionNote?: string;
  notes?: string;
  qualification?: QualificationResult;
  createdAt: string;
  updatedAt: string;
};
