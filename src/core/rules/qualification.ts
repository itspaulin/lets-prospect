import type { Company, Priority } from '../entities/company.js';
import type { Contact } from '../entities/contact.js';
import type { Evidence } from '../entities/evidence.js';
import type { CriterionOutcome, CriterionResult, QualificationResult } from '../entities/qualification.js';
import type { Criterion, ScoringConfig } from './scoring-config.js';
import { isDecisionMaker } from './decision-maker.js';
import { keepWanted, normalizeStack } from './technology.js';

type Input = { company: Company; evidences: Evidence[]; contacts: Contact[] };
type Outcome = { outcome: CriterionOutcome; factor: number; detail: string };

const quote = (evidences: Evidence[]): string => evidences.map((evidence) => `"${evidence.claim}"`).join('; ');

// Verified facts beat hypotheses, and a verified contradiction beats a verified confirmation.
const evaluateEvidence = (evidences: Evidence[], hypothesisFactor: number): Outcome => {
  if (evidences.length === 0) return { outcome: 'unknown', factor: 0, detail: 'sem evidências registradas' };
  const pick = (certainty: Evidence['certainty'], stance: Evidence['stance']) =>
    evidences.filter((evidence) => evidence.certainty === certainty && evidence.stance === stance);
  const verifiedAgainst = pick('verified', 'contradicts');
  if (verifiedAgainst.length) return { outcome: 'not_met', factor: 0, detail: `fato contrário: ${quote(verifiedAgainst)}` };
  const verifiedFor = pick('verified', 'supports');
  if (verifiedFor.length) return { outcome: 'met', factor: 1, detail: `fato: ${quote(verifiedFor)}` };
  const hypothesisFor = pick('hypothesis', 'supports');
  const hypothesisAgainst = pick('hypothesis', 'contradicts');
  if (hypothesisFor.length && !hypothesisAgainst.length)
    return { outcome: 'partial', factor: hypothesisFactor, detail: `apenas hipótese: ${quote(hypothesisFor)}` };
  return { outcome: 'unknown', factor: 0, detail: `hipóteses inconclusivas: ${quote(evidences)}` };
};

const evaluateCriterion = (criterion: Criterion, input: Input, config: ScoringConfig): Outcome => {
  const { company } = input;
  switch (criterion.type) {
    case 'evidence':
      return evaluateEvidence(
        input.evidences.filter((evidence) => evidence.kind === criterion.evidenceKind),
        config.hypothesisFactor,
      );
    case 'employee_range': {
      if (company.employeeCount === undefined) return { outcome: 'unknown', factor: 0, detail: 'número de funcionários não informado' };
      const inRange = company.employeeCount >= criterion.min && company.employeeCount <= criterion.max;
      return {
        outcome: inRange ? 'met' : 'not_met',
        factor: inRange ? 1 : 0,
        detail: `~${company.employeeCount} funcionários (faixa ${criterion.min}-${criterion.max})`,
      };
    }
    case 'country':
      if (criterion.primary.includes(company.country)) return { outcome: 'met', factor: 1, detail: `${company.country} é mercado prioritário` };
      if (criterion.secondary.includes(company.country))
        return { outcome: 'partial', factor: criterion.secondaryFactor, detail: `${company.country} é mercado secundário` };
      return { outcome: 'not_met', factor: 0, detail: `${company.country} fora dos mercados definidos` };
    // Share of the company's stack that is also mine: 4 of 10 matching scores 40% of the weight.
    case 'technology_overlap': {
      const stack = normalizeStack(company.technologies, criterion.technologies);
      if (stack.length === 0) return { outcome: 'unknown', factor: 0, detail: 'tecnologias não informadas' };
      const matches = keepWanted(stack, criterion.technologies);
      const share = matches.length / stack.length;
      const summary = `${matches.length} de ${stack.length} tecnologia${stack.length === 1 ? '' : 's'} batem${matches.length ? `: ${matches.join(', ')}` : ''}`;
      if (matches.length === 0) return { outcome: 'not_met', factor: 0, detail: summary };
      if (stack.length < criterion.minKnown)
        return {
          outcome: 'partial',
          factor: share * config.hypothesisFactor,
          detail: `${summary} (poucos dados: menos de ${criterion.minKnown} tecnologias conhecidas, vale como hipótese)`,
        };
      return { outcome: share === 1 ? 'met' : 'partial', factor: share, detail: summary };
    }
    case 'decision_maker_contact': {
      const roles = criterion.roles.map((role) => role.toLowerCase());
      const matches = input.contacts.filter(
        (contact) => contact.verificationStatus !== 'invalid' && contact.role && (isDecisionMaker(contact.role) || roles.some((role) => contact.role!.toLowerCase().includes(role))),
      );
      if (matches.length === 0) return { outcome: 'not_met', factor: 0, detail: 'nenhum decisor cadastrado' };
      return { outcome: 'met', factor: 1, detail: `decisores: ${matches.map((contact) => `${contact.name} (${contact.role})`).join(', ')}` };
    }
  }
};

const round = (value: number): number => Math.round(value * 100) / 100;

export const evaluateQualification = (input: Input, config: ScoringConfig, evaluatedAt: string): QualificationResult => {
  const criteria: CriterionResult[] = config.criteria.map((criterion) => {
    const result = evaluateCriterion(criterion, input, config);
    return { id: criterion.id, label: criterion.label, weight: criterion.weight, outcome: result.outcome, points: round(criterion.weight * result.factor), detail: result.detail };
  });
  const maxScore = criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  const score = round(criteria.reduce((sum, criterion) => sum + criterion.points, 0));
  const known = criteria.filter((criterion) => criterion.outcome !== 'unknown').reduce((sum, criterion) => sum + criterion.weight, 0);
  const coverage = round(known / maxScore);
  const missingRequired = config.requiredForQualified.filter((id) => criteria.find((criterion) => criterion.id === id)?.outcome !== 'met');

  let suggestedPriority: Priority | undefined;
  if (coverage >= config.minCoverageForPriority) {
    const ratio = score / maxScore;
    suggestedPriority = ratio >= config.priorityThresholds.high ? 'high' : ratio >= config.priorityThresholds.medium ? 'medium' : 'low';
  }

  return { configVersion: config.version, score, maxScore, coverage, suggestedPriority, missingRequired, criteria, evaluatedAt };
};
