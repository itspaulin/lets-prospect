import assert from 'node:assert/strict';
import test from 'node:test';
import { decisionMakerScore, isDecisionMaker } from './decision-maker.js';

test('classifica cargos de quem decide', () => {
  for (const role of ['Founder', 'Co-Founder & CEO', 'Managing Director', 'CTO', 'Chief Operating Officer', 'Head of Engineering', 'Technical Director', 'VP Engineering'])
    assert.ok(isDecisionMaker(role), role);
});

test('descarta devs, analistas, gerentes e diretores de áreas não técnicas', () => {
  for (const role of ['Senior Frontend Developer', 'Senior Business Analyst', 'Engineering Manager', 'Marketing Director', 'Head of Sales', 'HR Director', undefined])
    assert.ok(!isDecisionMaker(role), String(role));
});

test('dono vence CTO na ordenação', () => {
  assert.ok(decisionMakerScore('Founder') > decisionMakerScore('CTO'));
  assert.equal(decisionMakerScore('Chief Executive Officer'), decisionMakerScore('CEO'));
  assert.ok(decisionMakerScore('CTO') > decisionMakerScore('Director of Engineering'));
});

test('ordem de relevância: CEO e fundador, CTO, outros C-levels, heads, diretores', () => {
  const order = ['Chief Executive Officer', 'CTO', 'Chief Operating Officer', 'Head of Engineering', 'Director of Operations'];
  const scores = order.map(decisionMakerScore);
  assert.deepEqual([...scores].sort((a, b) => b - a), scores);
  assert.equal(new Set(scores).size, scores.length);
  assert.equal(decisionMakerScore('Co-founder & Head of Sales'), decisionMakerScore('CEO'));
});
