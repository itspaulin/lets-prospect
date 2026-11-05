import { z } from 'zod';
import { CERTAINTIES, EVIDENCE_KINDS, type Evidence, STANCES } from '../entities/evidence.js';
import { DomainError } from '../errors.js';
import type { Deps } from '../ports/runtime.js';
import { isoDate, nowIso, parseInput, record, resolveCompany, today } from './shared.js';

const schema = z.object({
  kind: z.enum(EVIDENCE_KINDS),
  claim: z.string().trim().min(1),
  certainty: z.enum(CERTAINTIES),
  stance: z.enum(STANCES).default('supports'),
  source: z.string().trim().min(1).optional(),
  observedAt: isoDate.optional(),
});

export type AddEvidenceInput = z.input<typeof schema>;

export const addEvidence = (deps: Deps, ref: string, input: AddEvidenceInput): Evidence => {
  const data = parseInput(schema, input);
  if (data.certainty === 'verified' && !data.source)
    throw new DomainError('validation', 'Fato verificado exige --source (URL ou descrição de onde foi confirmado)');
  return deps.store.transaction(() => {
    const company = resolveCompany(deps, ref);
    const evidence: Evidence = { ...data, id: deps.newId(), companyId: company.id, observedAt: data.observedAt ?? today(deps), createdAt: nowIso(deps) };
    deps.store.evidences.insert(evidence);
    record(deps, {
      companyId: company.id,
      type: 'evidence_added',
      summary: `${evidence.certainty === 'verified' ? 'Fato' : 'Hipótese'} (${evidence.kind}, ${evidence.stance}): ${evidence.claim}`,
      data: { evidenceId: evidence.id, source: evidence.source },
    });
    return evidence;
  });
};
