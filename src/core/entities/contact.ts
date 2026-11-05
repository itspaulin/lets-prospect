export const VERIFICATION_STATUSES = ['unverified', 'verified', 'invalid'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export type Contact = {
  id: string;
  companyId: string;
  name: string;
  role?: string;
  email?: string;
  source?: string;
  profileUrl?: string;
  identifiedAt: string;
  verificationStatus: VerificationStatus;
  doNotContact: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};
