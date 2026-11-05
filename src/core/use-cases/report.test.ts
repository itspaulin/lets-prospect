import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestDeps } from '../../testing/deps.js';
import { FIRST_TEMPLATE, qualifiedCompany } from '../../testing/outreach.js';
import { activateCampaign, approveTemplate, createCampaign, selectTargets, setTemplate } from './campaigns.js';
import { changeCompanyStatus } from './companies.js';
import { approveMessage, draftAll } from './messages.js';
import { recordReply } from './replies.js';
import { buildReport } from './report.js';
import { sendApproved } from './send.js';

test('sem dados as taxas ficam indefinidas, sem divisão por zero', () => {
  const { deps } = createTestDeps();
  const report = buildReport(deps);
  assert.ok(report.rates.every((rate) => rate.value === null && rate.denominator === 0));
  assert.match(report.warnings[0]!, /Nenhum primeiro contato/);
  assert.equal(report.operational['Empresas cadastradas'], 0);
});

test('calcula taxas com denominadores explícitos e quebra por campanha e país', async () => {
  const context = createTestDeps();
  const { deps } = context;
  createCampaign(deps, { name: 'c' });
  setTemplate(deps, 'c', { step: 0, ...FIRST_TEMPLATE });
  approveTemplate(deps, 'c', 0);
  activateCampaign(deps, 'c');
  const domains = ['a.dev', 'b.dev', 'c.dev', 'd.dev'];
  domains.forEach((domain, index) => qualifiedCompany(deps, { name: `Co ${index}`, website: domain, source: domain, country: index === 3 ? 'US' : 'GB' }, `cto@${domain}`));
  selectTargets(deps, 'c', {});
  for (const message of draftAll(deps, 'c').drafted) approveMessage(deps, message.id);
  let calls = 0;
  context.email.next = () => (++calls === 4 ? { status: 'failed', error: '550' } : { status: 'sent' });
  await sendApproved(deps, 'c');

  recordReply(deps, 'cto@a.dev', { category: 'interested_to_talk' });
  recordReply(deps, 'cto@b.dev', { category: 'no_need_now' });
  recordReply(deps, 'cto@c.dev', { category: 'auto_reply' });
  for (const status of ['interested', 'opportunity', 'converted'] as const) changeCompanyStatus(deps, 'a.dev', status);

  const report = buildReport(deps);
  const rate = (name: string) => report.rates.find((item) => item.name === name)!;
  assert.deepEqual([rate('Taxa de resposta').numerator, rate('Taxa de resposta').denominator, rate('Taxa de resposta').value], [2, 3, 66.7]);
  assert.deepEqual([rate('Taxa de interesse').numerator, rate('Taxa de interesse').denominator], [1, 2]);
  assert.deepEqual([rate('Taxa de conversão').numerator, rate('Taxa de conversão').denominator], [1, 3]);
  assert.deepEqual([rate('Taxa de falha de envio').numerator, rate('Taxa de falha de envio').denominator], [1, 4]);
  assert.equal(report.operational['Contratações ou colaborações (converted)'], 1);
  assert.equal(report.operational['Falhas de envio (período)'], 1);
  assert.deepEqual(report.byCountry.map((cohort) => [cohort.label, cohort.reached]), [['GB', 3]]);
  assert.deepEqual(report.byCampaign.map((cohort) => cohort.label), ['c']);
  assert.match(report.warnings.join(' '), /Amostra pequena/);

  const empty = buildReport(deps, { from: '2026-12-01' });
  assert.equal(empty.rates[0]!.denominator, 0);
});
