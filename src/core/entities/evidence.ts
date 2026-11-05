export const EVIDENCE_KINDS = ['business_model', 'size', 'technology', 'recurring_work', 'demand_signal', 'other'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const CERTAINTIES = ['verified', 'hypothesis'] as const;
export type Certainty = (typeof CERTAINTIES)[number];

export const STANCES = ['supports', 'contradicts'] as const;
export type Stance = (typeof STANCES)[number];

export type Evidence = {
  id: string;
  companyId: string;
  kind: EvidenceKind;
  claim: string;
  certainty: Certainty;
  stance: Stance;
  source?: string;
  observedAt: string;
  createdAt: string;
};
