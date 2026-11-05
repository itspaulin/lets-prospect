import assert from 'node:assert/strict';
import test from 'node:test';
import type { Company } from '../entities/company.js';
import type { Contact } from '../entities/contact.js';
import type { Evidence } from '../entities/evidence.js';
import { loadScoringConfig } from '../../infra/scoring.js';
import { SCORING_PATH } from '../../testing/deps.js';
import { evaluateQualification } from './qualification.js';

const config = loadScoringConfig(SCORING_PATH);
const at = '2026-10-26T12:00:00.000Z';

const company = (overrides: Partial<Company> = {}): Company => ({
  id: 'c1', name: 'Acme', domain: 'acme.dev', website: 'acme.dev', country: 'US', technologies: [], status: 'identified', createdAt: at, updatedAt: at, ...overrides,
});

const evidence = (overrides: Partial<Evidence>): Evidence => ({
  id: 'e', companyId: 'c1', kind: 'business_model', claim: 'agência que atende clientes', certainty: 'verified', stance: 'supports', source: 'https://acme.dev', observedAt: '2026-10-26', createdAt: at, ...overrides,
});

const cto: Contact = {
  id: 'p1', companyId: 'c1', name: 'Jane', role: 'CTO', email: 'jane@acme.dev', source: 'site', identifiedAt: '2026-10-26', verificationStatus: 'unverified', doNotContact: false, createdAt: at, updatedAt: at,
};

const criterion = (result: ReturnType<typeof evaluateQualification>, id: string) => result.criteria.find((item) => item.id === id)!;

test('dados incompletos ficam como desconhecidos, sem prioridade sugerida', () => {
  const result = evaluateQualification({ company: company(), evidences: [], contacts: [] }, config, at);
  assert.equal(criterion(result, 'size').outcome, 'unknown');
  assert.equal(criterion(result, 'stack').outcome, 'unknown');
  assert.equal(criterion(result, 'business_model').outcome, 'unknown');
  assert.equal(criterion(result, 'country').outcome, 'met');
  assert.equal(result.suggestedPriority, undefined);
  assert.deepEqual(result.missingRequired, ['business_model']);
  assert.ok(result.coverage < config.minCoverageForPriority);
});

test('empresa aderente recebe pontuação alta com motivos', () => {
  const result = evaluateQualification(
    {
      company: company({ employeeCount: 15, technologies: ['TypeScript', 'React', 'PostgreSQL'] }),
      evidences: [evidence({}), evidence({ id: 'e2', kind: 'recurring_work', claim: 'equipes dedicadas' }), evidence({ id: 'e3', kind: 'demand_signal', claim: 'contratando', certainty: 'hypothesis', source: undefined })],
      contacts: [cto],
    },
    config,
    at,
  );
  assert.equal(result.score, 95);
  assert.equal(result.maxScore, 100);
  assert.equal(result.suggestedPriority, 'high');
  assert.deepEqual(result.missingRequired, []);
  assert.equal(criterion(result, 'demand_signal').outcome, 'partial');
  assert.match(criterion(result, 'stack').detail, /3 de 3 tecnologias batem: TypeScript, React, PostgreSQL/);
});

test('hipótese conta pela metade e não satisfaz requisito obrigatório', () => {
  const result = evaluateQualification({ company: company(), evidences: [evidence({ certainty: 'hypothesis', source: undefined })], contacts: [] }, config, at);
  assert.equal(criterion(result, 'business_model').points, 15);
  assert.deepEqual(result.missingRequired, ['business_model']);
});

test('fato contrário prevalece sobre fato favorável', () => {
  const result = evaluateQualification(
    { company: company(), evidences: [evidence({}), evidence({ id: 'e2', claim: 'só produto próprio, não atende clientes', stance: 'contradicts' })], contacts: [] },
    config,
    at,
  );
  assert.equal(criterion(result, 'business_model').outcome, 'not_met');
  assert.deepEqual(result.missingRequired, ['business_model']);
});

test('mercado secundário pontua proporcionalmente', () => {
  const result = evaluateQualification({ company: company({ country: 'CA' }), evidences: [], contacts: [] }, config, at);
  assert.equal(criterion(result, 'country').points, 9);
});

const stackOf = (count: number, mine: number) => [
  ...['Node.js', 'TypeScript', 'React', 'PostgreSQL', 'Docker', 'Redis', 'Go', 'AWS', 'Next.js', 'NestJS'].slice(0, mine),
  ...Array.from({ length: count - mine }, (_, index) => `Outra${index}`),
];

test('stack: a nota é a parte da stack da empresa que bate com a minha', () => {
  const stack = (technologies: string[]) => criterion(evaluateQualification({ company: company({ technologies }), evidences: [], contacts: [] }, config, at), 'stack');
  const weight = stack([]).weight;
  const points = (share: number) => Math.round(weight * share * 100) / 100;
  // 4 de 10, 10 de 20 e 7 de 8: 40%, 50% e 87,5% do peso.
  assert.equal(stack(stackOf(10, 4)).points, points(0.4));
  assert.equal(stack(stackOf(20, 10)).points, points(0.5));
  assert.equal(stack(stackOf(8, 7)).points, points(0.875));
  assert.match(stack(stackOf(8, 7)).detail, /^7 de 8 tecnologias batem/);
  assert.equal(stack(stackOf(4, 4)).outcome, 'met');
  assert.equal(stack(stackOf(5, 0)).outcome, 'not_met');
});

test('stack: sinônimos contam uma vez e poucos dados valem como hipótese', () => {
  const stack = (technologies: string[]) => criterion(evaluateQualification({ company: company({ technologies }), evidences: [], contacts: [] }, config, at), 'stack');
  assert.match(stack(['NodeJS', 'Node.js', 'PHP', 'Laravel']).detail, /^1 de 3/);
  // Só "React" no site: 100% de 1 tecnologia, mas vale metade por ser pouco dado.
  const thin = stack(['React']);
  assert.equal(thin.outcome, 'partial');
  assert.equal(thin.points, thin.weight * config.hypothesisFactor);
  assert.match(thin.detail, /poucos dados/);
});

test('fora da faixa de tamanho e contato inválido não pontuam', () => {
  const result = evaluateQualification(
    { company: company({ employeeCount: 400 }), evidences: [], contacts: [{ ...cto, verificationStatus: 'invalid' }] },
    config,
    at,
  );
  assert.equal(criterion(result, 'size').outcome, 'not_met');
  assert.equal(criterion(result, 'decision_maker').outcome, 'not_met');
});
