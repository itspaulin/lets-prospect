import type { Company } from '../entities/company.js';
import type { QualificationResult } from '../entities/qualification.js';
import type { Deps } from '../ports/runtime.js';
import { evaluateQualification } from '../rules/qualification.js';
import { nowIso, record, resolveCompany } from './shared.js';

export const computeQualification = (deps: Deps, company: Company): QualificationResult =>
  evaluateQualification(
    { company, evidences: deps.store.evidences.listByCompany(company.id), contacts: deps.store.contacts.listByCompany(company.id) },
    deps.scoring,
    nowIso(deps),
  );

export const saveQualification = (deps: Deps, company: Company, result: QualificationResult): Company => {
  const updated = { ...company, qualification: result, updatedAt: result.evaluatedAt };
  deps.store.companies.update(updated);
  record(deps, {
    companyId: company.id,
    type: 'qualification_evaluated',
    summary: `Avaliação: ${result.score}/${result.maxScore}, cobertura ${Math.round(result.coverage * 100)}%, prioridade sugerida ${result.suggestedPriority ?? 'indefinida'}`,
    data: { score: result.score, maxScore: result.maxScore, coverage: result.coverage, suggestedPriority: result.suggestedPriority, missingRequired: result.missingRequired, configVersion: result.configVersion },
  });
  return updated;
};

export const evaluateCompany = (deps: Deps, ref: string): { company: Company; result: QualificationResult } =>
  deps.store.transaction(() => {
    const company = resolveCompany(deps, ref);
    const result = computeQualification(deps, company);
    return { company: saveQualification(deps, company, result), result };
  });
