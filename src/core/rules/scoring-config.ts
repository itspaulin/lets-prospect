import { z } from 'zod';
import { EVIDENCE_KINDS } from '../entities/evidence.js';

const base = { id: z.string().min(1), label: z.string().min(1), weight: z.number().positive() };

const criterionSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('evidence'), evidenceKind: z.enum(EVIDENCE_KINDS) }),
  z.object({ ...base, type: z.literal('employee_range'), min: z.number().int().nonnegative(), max: z.number().int().positive() }),
  z.object({
    ...base,
    type: z.literal('country'),
    primary: z.array(z.string().length(2)),
    secondary: z.array(z.string().length(2)).default([]),
    secondaryFactor: z.number().min(0).max(1),
  }),
  // minKnown: below this many known technologies the share is weak evidence and counts like a hypothesis.
  z.object({ ...base, type: z.literal('technology_overlap'), technologies: z.array(z.string().min(1)).min(1), minKnown: z.number().int().positive().default(3) }),
  z.object({ ...base, type: z.literal('decision_maker_contact'), roles: z.array(z.string().min(1)).min(1) }),
]);

export const scoringConfigSchema = z
  .object({
    version: z.number().int().positive(),
    hypothesisFactor: z.number().min(0).max(1),
    minCoverageForPriority: z.number().min(0).max(1),
    priorityThresholds: z.object({ high: z.number().min(0).max(1), medium: z.number().min(0).max(1) }),
    requiredForQualified: z.array(z.string()),
    criteria: z.array(criterionSchema).min(1),
  })
  .superRefine((config, ctx) => {
    const ids = config.criteria.map((criterion) => criterion.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'IDs de critérios repetidos' });
    for (const required of config.requiredForQualified)
      if (!ids.includes(required)) ctx.addIssue({ code: 'custom', message: `requiredForQualified cita critério inexistente: ${required}` });
  });

export type ScoringConfig = z.infer<typeof scoringConfigSchema>;
export type Criterion = ScoringConfig['criteria'][number];
