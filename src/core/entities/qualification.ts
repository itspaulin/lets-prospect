import type { Priority } from './company.js';

export type CriterionOutcome = 'met' | 'partial' | 'not_met' | 'unknown';

export type CriterionResult = {
  id: string;
  label: string;
  weight: number;
  outcome: CriterionOutcome;
  points: number;
  detail: string;
};

export type QualificationResult = {
  configVersion: number;
  score: number;
  maxScore: number;
  coverage: number;
  suggestedPriority?: Priority;
  missingRequired: string[];
  criteria: CriterionResult[];
  evaluatedAt: string;
};
