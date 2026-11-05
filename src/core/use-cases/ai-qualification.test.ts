import assert from 'node:assert/strict';
import test from 'node:test';
import type { Qualifier, QualifierVerdict, SiteFetcher, SitePage } from '../ports/qualification.js';
import { acme, createTestDeps } from '../../testing/deps.js';
import { DomainError } from '../errors.js';
import { addCompany } from './companies.js';
import { aiReviewQueue, pendingQualification, qualifyCompany, refreshTechnologies } from './ai-qualification.js';

const PAGE: SitePage = { url: 'https://acme.dev/', text: 'We build custom software for clients across the UK. Our dedicated teams ship React and Node.js products with AI and PHP.' };

const setup = (verdict: QualifierVerdict, pages: SitePage[] = [PAGE]) => {
  const ctx = createTestDeps();
  const fetcher: SiteFetcher = { fetchSite: async () => ({ pages, problem: pages.length ? undefined : 'bloqueado para robôs (HTTP 403)' }) };
  const qualifier: Qualifier = { name: 'fake', qualify: async () => verdict };
  ctx.deps.qualifying = { fetcher, qualifier };
  addCompany(ctx.deps, acme);
  return ctx;
};

const supports = { kind: 'business_model', stance: 'supports', claim: 'Builds custom software for clients', quote: 'We build custom software for clients', pageUrl: PAGE.url } as const;

test('qualifica quando a citação existe na página e grava fato verificado com a fonte', async () => {
  const { deps } = setup({ verdict: 'software_house', reason: 'Agência de software.', findings: [supports], technologies: ['React', 'Rust', 'AI', 'node.js', 'PHP'] });
  const result = await qualifyCompany(deps, 'acme.dev');
  assert.equal(result.outcome, 'qualified');
  const company = deps.store.companies.findByDomain('acme.dev')!;
  assert.equal(company.status, 'qualified');
  const [evidence] = deps.store.evidences.listByCompany(company.id);
  assert.equal(evidence?.certainty, 'verified');
  assert.equal(evidence?.source, PAGE.url);
  // Rust is not on the page and AI is a field, not a tool; PHP stays (it counts against the stack share).
  // node.js takes the stack list's spelling.
  assert.deepEqual([...company.technologies].sort(), ['Node.js', 'PHP', 'React', 'Ruby']);
});

test('citação inventada vira hipótese e não qualifica', async () => {
  const { deps } = setup({
    verdict: 'software_house',
    reason: 'Parece agência.',
    findings: [{ ...supports, quote: 'We have shipped over 400 projects for Fortune 500 clients' }],
    technologies: [],
  });
  const result = await qualifyCompany(deps, 'acme.dev');
  assert.equal(result.outcome, 'unclear');
  const company = deps.store.companies.findByDomain('acme.dev')!;
  assert.equal(company.status, 'identified');
  assert.equal(deps.store.evidences.listByCompany(company.id)[0]?.certainty, 'hypothesis');
});

test('citação que existe mas é item de menu não vira fato', async () => {
  const menu: SitePage = { url: PAGE.url, text: `${PAGE.text} Web Development Services Web Applications` };
  const { deps } = setup({ verdict: 'software_house', reason: 'x', findings: [{ ...supports, quote: 'Web Development Services Web Applications' }], technologies: [] }, [menu]);
  assert.equal((await qualifyCompany(deps, 'acme.dev')).outcome, 'unclear');
});

test('citação apontando para página que não foi lida também não vale', async () => {
  const { deps } = setup({ verdict: 'software_house', reason: 'x', findings: [{ ...supports, pageUrl: 'https://acme.dev/other' }], technologies: [] });
  assert.equal((await qualifyCompany(deps, 'acme.dev')).outcome, 'unclear');
});

test('desqualifica só com contradição verificada, e dá para reverter', async () => {
  const contradiction = { ...supports, stance: 'contradicts', claim: 'Sells its own product', quote: 'We build custom software for clients' } as const;
  const { deps } = setup({ verdict: 'not_a_fit', reason: 'Empresa de produto.', findings: [contradiction], technologies: [] });
  assert.equal((await qualifyCompany(deps, 'acme.dev')).outcome, 'disqualified');
  assert.equal(deps.store.companies.findByDomain('acme.dev')?.status, 'disqualified');
});

test('not_a_fit sem citação verificável fica para revisão, não desqualifica', async () => {
  const { deps } = setup({ verdict: 'not_a_fit', reason: 'x', findings: [], technologies: [] });
  assert.equal((await qualifyCompany(deps, 'acme.dev')).outcome, 'unclear');
  assert.equal(deps.store.companies.findByDomain('acme.dev')?.status, 'identified');
});

test('site inacessível não decide nada', async () => {
  const { deps } = setup({ verdict: 'software_house', reason: 'x', findings: [supports], technologies: [] }, []);
  const result = await qualifyCompany(deps, 'acme.dev');
  assert.equal(result.outcome, 'unreachable');
  assert.equal(result.reason, 'bloqueado para robôs (HTTP 403)');
  assert.equal(deps.store.companies.findByDomain('acme.dev')?.status, 'identified');
});

test('empresa que não está identified é pulada, e sem configuração avisa', async () => {
  const { deps } = setup({ verdict: 'software_house', reason: 'x', findings: [supports], technologies: [] });
  await qualifyCompany(deps, 'acme.dev');
  assert.equal((await qualifyCompany(deps, 'acme.dev')).outcome, 'skipped');
  deps.qualifying = undefined;
  await assert.rejects(qualifyCompany(deps, 'acme.dev'), (error) => error instanceof DomainError && error.code === 'requirement_missing');
});

test('pendentes: só identified sem veredito da IA; site não lido continua pendente', async () => {
  const { deps } = setup({ verdict: 'unclear', reason: 'pouco texto', findings: [], technologies: [] });
  addCompany(deps, { ...acme, name: 'Beta', website: 'beta.dev' });
  assert.deepEqual(pendingQualification(deps).map((company) => company.domain).sort(), ['acme.dev', 'beta.dev']);
  await qualifyCompany(deps, 'acme.dev');
  assert.deepEqual(pendingQualification(deps).map((company) => company.domain), ['beta.dev']);
  deps.qualifying!.fetcher = { fetchSite: async () => ({ pages: [], problem: 'tempo esgotado' }) };
  await qualifyCompany(deps, 'beta.dev');
  assert.deepEqual(pendingQualification(deps).map((company) => company.domain), ['beta.dev']);
});

test('fila de revisão mostra o motivo sem o prefixo, mesmo com ":" no nome do modelo', async () => {
  const { deps } = setup({ verdict: 'unclear', reason: 'Pouco texto sobre clientes.', findings: [], technologies: [] });
  deps.qualifying!.qualifier = { name: 'bedrock us.anthropic.claude-haiku-4-5-20251001-v1:0', qualify: deps.qualifying!.qualifier.qualify };
  await qualifyCompany(deps, 'acme.dev');
  const [item] = aiReviewQueue(deps);
  assert.equal(item?.kind, 'unclear');
  assert.equal(item?.note, 'unclear. Pouco texto sobre clientes.');
});

test('releitura da stack só acrescenta tecnologias, sem evidência nem mudança de status', async () => {
  const { deps } = setup({ verdict: 'not_a_fit', reason: 'x', findings: [{ ...supports, stance: 'contradicts' }], technologies: ['PHP', 'node.js'] });
  await refreshTechnologies(deps, 'acme.dev');
  const company = deps.store.companies.findByDomain('acme.dev')!;
  assert.equal(company.status, 'identified');
  assert.equal(deps.store.evidences.listByCompany(company.id).length, 0);
  assert.deepEqual([...company.technologies].sort(), ['Node.js', 'PHP', 'React', 'Ruby']);
});

test('consultoria de TI também é alvo e o tipo fica gravado na empresa', async () => {
  const { deps } = setup({ verdict: 'software_house', segment: 'it_consultancy', reason: 'Consultoria que aloca desenvolvedores.', findings: [supports], technologies: [] });
  assert.equal((await qualifyCompany(deps, 'acme.dev')).outcome, 'qualified');
  assert.equal(deps.store.companies.findByDomain('acme.dev')!.segment, 'consultoria de TI');
});

test('software house comum recebe o tipo "software house"', async () => {
  const { deps } = setup({ verdict: 'software_house', segment: 'software_house', reason: 'Agência de software.', findings: [supports], technologies: [] });
  await qualifyCompany(deps, 'acme.dev');
  assert.equal(deps.store.companies.findByDomain('acme.dev')!.segment, 'software house');
});
