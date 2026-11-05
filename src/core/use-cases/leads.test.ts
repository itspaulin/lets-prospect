import assert from 'node:assert/strict';
import test from 'node:test';
import { DomainError } from '../errors.js';
import type { PageFetcher, RawSiteRead } from '../ports/pages.js';
import type { Place, PlaceQuery, PlaceSource } from '../ports/places.js';
import { createTestDeps } from '../../testing/deps.js';
import type { LeadQualifier, LeadQualifierVerdict } from '../ports/lead-qualification.js';
import { discoverLeads, discoverNextLeads, enrichLeads, listLeads, qualifyLeads } from './leads.js';

class FakePlaces implements PlaceSource {
  readonly name = 'fake places';
  readonly queries: PlaceQuery[] = [];
  constructor(private readonly found: Place[]) {}
  async search(query: PlaceQuery): Promise<Place[]> {
    this.queries.push(query);
    return this.found;
  }
}

const setup = (found: Place[]) => {
  const { deps, ...rest } = createTestDeps();
  const places = new FakePlaces(found);
  deps.places = places;
  return { deps, places, ...rest };
};

const mobile = (placeId: string, phone = '+55 31 99999-8888'): Place => ({ placeId, name: `Imob ${placeId}`, phone, website: 'https://x.com.br', rating: 4.8, reviewCount: 12 });

test('descoberta monta a busca e cadastra leads com telefone em E.164', async () => {
  const { deps, places } = setup([mobile('a')]);
  const report = await discoverLeads(deps, { city: 'Belo Horizonte', state: 'mg' });
  assert.deepEqual(places.queries, [{ text: 'imobiliária em Belo Horizonte, MG', limit: 20 }]);
  assert.deepEqual(report.imported, [{ name: 'Imob a', phone: '+5531999998888', kind: 'mobile' }]);
  const [lead] = listLeads(deps);
  assert.equal(lead!.status, 'identified');
  assert.equal(lead!.city, 'Belo Horizonte');
  assert.equal(lead!.state, 'MG');
  assert.equal(lead!.segment, 'imobiliária');
  assert.equal(lead!.source, 'fake places, 2026-10-26');
  assert.equal(lead!.rating, 4.8);
});

test('rodar a mesma busca duas vezes não duplica: mesmo lugar ou mesmo telefone é pulado', async () => {
  const { deps } = setup([mobile('a'), mobile('b', '(31) 98888-7777')]);
  await discoverLeads(deps, { city: 'Contagem' });
  const again = await discoverLeads(deps, { city: 'Contagem' });
  assert.equal(again.imported.length, 0);
  assert.equal(again.alreadyKnown.length, 2);
  deps.places = new FakePlaces([mobile('c', '31 99999-8888')]);
  assert.equal((await discoverLeads(deps, { city: 'Contagem' })).alreadyKnown.length, 1);
  assert.equal(listLeads(deps).length, 2);
});

test('sem telefone ou com telefone fora do padrão não vira lead, e fixo é marcado', async () => {
  const { deps } = setup([
    { placeId: 'n', name: 'Sem fone' },
    { placeId: 'x', name: 'Gringa', phone: '+1 415 555 2671' },
    { placeId: 'f', name: 'Fixa', phone: '(31) 3333-4444' },
    mobile('m'),
  ]);
  const report = await discoverLeads(deps, { city: 'Betim' });
  assert.deepEqual(report.noPhone, ['Sem fone']);
  assert.deepEqual(report.invalidPhone, ['Gringa (+1 415 555 2671)']);
  assert.deepEqual(report.imported.map((item) => [item.name, item.kind]), [['Fixa', 'landline'], ['Imob m', 'mobile']]);
});

test('dry-run mostra o que entraria sem gravar', async () => {
  const { deps } = setup([mobile('a')]);
  const report = await discoverLeads(deps, { city: 'Betim', dryRun: true });
  assert.equal(report.imported.length, 1);
  assert.equal(listLeads(deps).length, 0);
});

test('sem chave do Google ou com entrada inválida diz o que falta', async () => {
  const { deps } = createTestDeps();
  await assert.rejects(discoverLeads(deps, { city: 'Betim' }), (error: unknown) => error instanceof DomainError && error.code === 'requirement_missing' && /GOOGLE_PLACES_API_KEY/.test(error.message));
  deps.places = new FakePlaces([]);
  await assert.rejects(discoverLeads(deps, { city: '' }), (error: unknown) => error instanceof DomainError && error.code === 'validation');
  await assert.rejects(discoverLeads(deps, { city: 'Betim', state: 'Minas' }), (error: unknown) => error instanceof DomainError && error.code === 'validation');
});

test('lista filtra por status e recusa status inexistente', async () => {
  const { deps } = setup([mobile('a')]);
  await discoverLeads(deps, { city: 'Betim' });
  assert.equal(listLeads(deps, { statuses: ['identified'] }).length, 1);
  assert.equal(listLeads(deps, { statuses: ['replied'] }).length, 0);
  assert.equal(listLeads(deps, { city: 'betim' }).length, 1);
  assert.throws(() => listLeads(deps, { statuses: ['nope'] }), (error: unknown) => error instanceof DomainError && error.code === 'validation');
});

class FakePages implements PageFetcher {
  readonly asked: string[] = [];
  constructor(private readonly sites: Record<string, RawSiteRead>) {}
  async fetchRaw(domain: string): Promise<RawSiteRead> {
    this.asked.push(domain);
    return this.sites[domain] ?? { pages: [], problem: 'erro de rede' };
  }
}

const withLeads = async (found: Place[], sites: Record<string, RawSiteRead>) => {
  const ctx = setup(found);
  ctx.deps.pages = new FakePages(sites);
  await discoverLeads(ctx.deps, { city: 'Betim' });
  return ctx;
};

const fixa = (placeId: string, website?: string): Place => ({ placeId, name: `Fixa ${placeId}`, phone: '(31) 3333-4444'.replace('4444', `44${placeId.padStart(2, '0')}`), website });

test('enrich pega o WhatsApp que o site publica e guarda de qual página veio', async () => {
  const { deps } = await withLeads([fixa('1', 'https://www.imob1.com.br/')], {
    'imob1.com.br': { pages: [{ url: 'https://imob1.com.br/', html: '<p>oi</p>' }, { url: 'https://imob1.com.br/contato', html: '<a href="https://wa.me/5531999998888">x</a>' }] },
  });
  const report = await enrichLeads(deps);
  assert.deepEqual(report.found, [{ name: 'Fixa 1', whatsapp: '+5531999998888', source: 'https://imob1.com.br/contato' }]);
  const [lead] = listLeads(deps);
  assert.equal(lead!.whatsapp, '+5531999998888');
  assert.equal(lead!.whatsappSource, 'https://imob1.com.br/contato');
  assert.ok(lead!.enrichedAt);
  assert.equal(lead!.enrichmentNote, undefined);
});

test('enrich: fixo sem WhatsApp no site fica sem número, com o motivo', async () => {
  const { deps } = await withLeads([fixa('1', 'https://imob1.com.br'), fixa('2'), fixa('3', 'https://imob3.com.br')], {
    'imob1.com.br': { pages: [{ url: 'https://imob1.com.br/', html: '<p>só telefone fixo</p>' }] },
    'imob3.com.br': { pages: [], problem: 'bloqueado para robôs (HTTP 403)' },
  });
  const report = await enrichLeads(deps);
  assert.deepEqual(report.notFound.map((item) => item.reason), ['o site não publica número de WhatsApp', 'sem site e o telefone do Google é fixo', 'bloqueado para robôs (HTTP 403)']);
  assert.ok(listLeads(deps).every((lead) => !lead.whatsapp && lead.enrichedAt && lead.enrichmentNote));
});

test('enrich: celular do cadastro serve de reserva, marcado como não confirmado, e o site tem prioridade', async () => {
  const { deps } = await withLeads([mobile('a'), { ...mobile('b', '(31) 98888-7777'), website: 'https://imobb.com.br' }], {
    'x.com.br': { pages: [{ url: 'https://x.com.br/', html: '<p>sem link</p>' }] },
    'imobb.com.br': { pages: [{ url: 'https://imobb.com.br/', html: '<a href="https://wa.me/5531977776666">x</a>' }] },
  });
  const report = await enrichLeads(deps);
  assert.deepEqual(report.fromListing, [{ name: 'Imob a', whatsapp: '+5531999998888' }]);
  assert.deepEqual(report.found.map((item) => item.whatsapp), ['+5531977776666']);
  assert.match(listLeads(deps)[0]!.whatsappSource!, /não confirmado/);
});

test('enrich não refaz o que já foi lido, respeita o limite e --retry tenta de novo só os sem número', async () => {
  const { deps } = await withLeads([fixa('1', 'https://imob1.com.br'), fixa('2', 'https://imob2.com.br')], {});
  const pages = deps.pages as FakePages;
  assert.equal((await enrichLeads(deps, { limit: 1 })).notFound.length, 1);
  assert.equal((await enrichLeads(deps)).notFound.length, 1);
  assert.equal((await enrichLeads(deps)).notFound.length, 0);
  assert.equal(pages.asked.length, 2);
  deps.pages = new FakePages({ 'imob1.com.br': { pages: [{ url: 'https://imob1.com.br/', html: '<a href="https://wa.me/5531999998888">x</a>' }] } });
  const retried = await enrichLeads(deps, { retry: true });
  assert.equal(retried.found.length, 1);
  assert.equal(retried.notFound.length, 1);
  assert.equal((await enrichLeads(deps, { retry: true })).found.length, 0);
});

test('enrich sem leitor de sites avisa', async () => {
  const { deps } = createTestDeps();
  await assert.rejects(enrichLeads(deps), (error: unknown) => error instanceof DomainError && error.code === 'requirement_missing');
});

const SENTENCE = 'Somos uma imobiliária com mais de vinte anos vendendo e alugando imóveis em Betim.';
const PORTAL = 'Somos um portal de anúncios onde várias imobiliárias publicam seus imóveis para venda.';

class FakeJudge implements LeadQualifier {
  readonly name = 'fake ai';
  calls = 0;
  constructor(private readonly verdict: LeadQualifierVerdict | ((name: string) => LeadQualifierVerdict)) {}
  async qualify(input: { lead: { name: string } }): Promise<LeadQualifierVerdict> {
    this.calls++;
    return typeof this.verdict === 'function' ? this.verdict(input.lead.name) : this.verdict;
  }
}

const fitVerdict = (quote = SENTENCE): LeadQualifierVerdict => ({ verdict: 'fit', reason: 'é uma imobiliária', signals: [{ kind: 'activity', claim: 'vende e aluga', quote, pageUrl: 'https://imob.com.br/' }] });

const judged = async (verdict: LeadQualifierVerdict | ((name: string) => LeadQualifierVerdict), sites: Record<string, { text?: string; problem?: string }>, found: Place[]) => {
  const ctx = setup(found);
  await discoverLeads(ctx.deps, { city: 'Betim' });
  for (const lead of ctx.deps.store.leads.list()) ctx.deps.store.leads.update({ ...lead, whatsapp: lead.phone, enrichedAt: '2026-10-26T10:00:00.000Z' });
  const judge = new FakeJudge(verdict);
  ctx.deps.leadQualifier = judge;
  ctx.deps.qualifying = {
    fetcher: { fetchSite: async (domain: string) => (sites[domain]?.text ? { pages: [{ url: `https://${domain}/`, text: sites[domain]!.text! }] } : { pages: [], problem: sites[domain]?.problem ?? 'erro de rede' }) },
    qualifier: undefined as never,
  };
  return { ...ctx, judge };
};

const site = (id: string): Place => ({ ...mobile(id, `(31) 9${id.padStart(4, '0')}-1111`), website: `https://imob${id}.com.br` });

test('qualify: citação verificada no site dá "fit" e guarda os sinais', async () => {
  const { deps } = await judged(fitVerdict(), { 'imob1.com.br': { text: SENTENCE } }, [site('1')]);
  deps.leadQualifier = new FakeJudge({ verdict: 'fit', reason: 'é uma imobiliária', signals: [{ kind: 'activity', claim: 'vende e aluga', quote: SENTENCE, pageUrl: 'https://imob1.com.br/' }] });
  const report = await qualifyLeads(deps);
  assert.deepEqual(report.results, [{ name: 'Imob 1', outcome: 'fit', reason: 'é uma imobiliária' }]);
  const [lead] = listLeads(deps);
  assert.equal(lead!.qualification!.verdict, 'fit');
  assert.equal(lead!.qualification!.signals[0]!.verified, true);
  assert.ok(lead!.qualifiedAt);
});

test('qualify: veredito sem citação verificável vira "unclear", nunca "fit"', async () => {
  const { deps } = await judged(fitVerdict(), { 'imob1.com.br': { text: PORTAL } }, [site('1')]);
  deps.leadQualifier = new FakeJudge({ verdict: 'fit', reason: 'parece imobiliária', signals: [{ kind: 'activity', claim: 'inventado', quote: SENTENCE, pageUrl: 'https://imob1.com.br/' }] });
  const report = await qualifyLeads(deps);
  assert.equal(report.results[0]!.outcome, 'unclear');
  assert.match(report.results[0]!.reason, /sem citação verificável/);
  assert.equal(listLeads(deps)[0]!.qualification!.signals[0]!.verified, false);
});

test('qualify: descarte exige citação verificada contra o perfil', async () => {
  const { deps } = await judged(fitVerdict(), { 'imob1.com.br': { text: PORTAL }, 'imob2.com.br': { text: PORTAL } }, [site('1'), site('2')]);
  deps.leadQualifier = new FakeJudge((name) =>
    name === 'Imob 1'
      ? { verdict: 'not_a_fit', reason: 'é um portal', signals: [{ kind: 'contradiction', claim: 'portal', quote: PORTAL, pageUrl: 'https://imob1.com.br/' }] }
      : { verdict: 'not_a_fit', reason: 'é um portal', signals: [{ kind: 'contradiction', claim: 'portal', quote: 'texto que não está no site de jeito nenhum aqui', pageUrl: 'https://imob2.com.br/' }] },
  );
  const report = await qualifyLeads(deps);
  assert.deepEqual(report.results.map((item) => item.outcome), ['not_a_fit', 'unclear']);
});

test('qualify: site que não abre não gasta a IA e tenta de novo na próxima; sem site fica em dúvida', async () => {
  const { deps, judge } = await judged(fitVerdict(), {}, [site('1'), { ...mobile('2', '(31) 99222-1111'), website: undefined }]);
  const first = await qualifyLeads(deps);
  assert.deepEqual(first.results.map((item) => [item.outcome, item.reason]), [['unreachable', 'site não lido: erro de rede'], ['unclear', 'sem site para avaliar']]);
  assert.equal(judge.calls, 0);
  const again = await qualifyLeads(deps);
  assert.deepEqual(again.results.map((item) => item.outcome), ['unreachable']);
});

test('qualify: só julga quem tem WhatsApp, só uma vez, e avisa quando a IA não está configurada', async () => {
  const { deps, judge } = await judged(fitVerdict(), { 'imob1.com.br': { text: SENTENCE } }, [site('1'), { ...mobile('2', '(31) 99222-1111'), website: 'https://imob2.com.br' }]);
  deps.store.leads.update({ ...deps.store.leads.list()[1]!, whatsapp: undefined });
  deps.leadQualifier = new FakeJudge({ verdict: 'fit', reason: 'ok', signals: [{ kind: 'activity', claim: 'c', quote: SENTENCE, pageUrl: 'https://imob1.com.br/' }] });
  assert.equal((await qualifyLeads(deps)).results.length, 1);
  assert.equal((await qualifyLeads(deps)).results.length, 0);
  assert.equal(judge.calls, 0);
  const bare = createTestDeps().deps;
  await assert.rejects(qualifyLeads(bare), (error: unknown) => error instanceof DomainError && error.code === 'requirement_missing');
});

test('busca automática: só pesquisa quando faltam candidatos, um lugar por vez, e registra a pesquisa', async () => {
  const { deps, places } = setup([mobile('a')]);
  const first = await discoverNextLeads(deps);
  assert.deepEqual(first.searches, [{ query: 'imobiliária em Belo Horizonte, MG', imported: 1 }]);
  assert.deepEqual(places.queries, [{ text: 'imobiliária em Belo Horizonte, MG', limit: 40 }]);
  const second = await discoverNextLeads(deps);
  assert.deepEqual(second.searches.map((item) => item.query), ['imobiliária em Boa Viagem, Recife, PE']);
  const third = await discoverNextLeads(deps);
  assert.equal(third.searches.length, 0);
  assert.match(third.skipped!, /pesquisados há pouco/);
});

test('busca automática: com candidatos suficientes não gasta a cota, e depois do período repete', async () => {
  const { deps, places, advanceDays } = setup([]);
  deps.leadsConfig = { ...deps.leadsConfig, discovery: { ...deps.leadsConfig.discovery, minCandidates: 2 } };
  for (const id of ['x', 'y']) deps.store.leads.insert({ ...listLeadsSeed(id) });
  const enough = await discoverNextLeads(deps);
  assert.match(enough.skipped!, /já há 2 candidatos/);
  assert.equal(places.queries.length, 0);
  deps.leadsConfig = { ...deps.leadsConfig, discovery: { ...deps.leadsConfig.discovery, minCandidates: 99, maxSearchesPerRun: 5 } };
  assert.equal((await discoverNextLeads(deps)).searches.length, 2);
  advanceDays(31);
  assert.equal((await discoverNextLeads(deps)).searches.length, 2);
});

test('busca automática: respeita o teto mensal de requisições do Google', async () => {
  const { deps, places } = setup([]);
  deps.leadsConfig = { ...deps.leadsConfig, discovery: { ...deps.leadsConfig.discovery, minCandidates: 99, maxSearchesPerRun: 5, maxRequestsPerMonth: 2 } };
  const report = await discoverNextLeads(deps);
  assert.equal(report.searches.length, 1);
  assert.match(report.skipped!, /teto de 2 requisições/);
  assert.equal(places.queries.length, 1);
});

test('busca automática sem Google configurado avisa em vez de falhar', async () => {
  const { deps } = createTestDeps();
  assert.match((await discoverNextLeads(deps)).skipped!, /não configurado/);
});

test('descoberta aceita bairro e conta as requisições do Google', async () => {
  const { deps, places } = setup([mobile('a'), mobile('b', '(31) 98888-7777')]);
  await discoverLeads(deps, { city: 'Belo Horizonte', state: 'MG', area: 'Savassi' });
  assert.equal(places.queries[0]!.text, 'imobiliária em Savassi, Belo Horizonte, MG');
  assert.equal(deps.store.leadSearches.requestsSince('2026-10-01T00:00:00.000Z'), 1);
  await discoverLeads(deps, { city: 'Betim', dryRun: true });
  assert.equal(deps.store.leadSearches.requestsSince('2026-10-01T00:00:00.000Z'), 1);
});

const listLeadsSeed = (id: string) => ({
  id: `seed-${id}`, placeId: `p-${id}`, name: `Seed ${id}`, phone: `+55319${id.charCodeAt(0)}0000000`.slice(0, 14), phoneKind: 'mobile' as const,
  segment: 'imobiliária', status: 'identified' as const, source: 't', createdAt: '2026-10-26T10:00:00.000Z', updatedAt: '2026-10-26T10:00:00.000Z',
});

const judgedFrom = async (ctx: ReturnType<typeof setup>) => {
  for (const lead of ctx.deps.store.leads.list()) ctx.deps.store.leads.update({ ...lead, whatsapp: lead.phone, enrichedAt: '2026-10-26T10:00:00.000Z' });
  ctx.deps.leadQualifier = new FakeJudge(fitVerdict());
  ctx.deps.qualifying = { fetcher: { fetchSite: async () => ({ pages: [] }) }, qualifier: undefined as never };
  return ctx;
};

test('enrich e qualify podem ser interrompidos entre um lead e outro', async () => {
  const ctx = setup([site('1'), site('2'), site('3')]);
  await discoverLeads(ctx.deps, { city: 'Betim' });
  ctx.deps.pages = new FakePages({ 'imob1.com.br': { pages: [] }, 'imob2.com.br': { pages: [] }, 'imob3.com.br': { pages: [] } });
  let allowed = 1;
  const report = await enrichLeads(ctx.deps, {}, { shouldStop: () => allowed-- <= 0 });
  // The test leads have mobile numbers, so the one lead read before the stop falls back to the number from Google.
  assert.equal(report.fromListing.length, 1);
  assert.equal(listLeads(ctx.deps).filter((lead) => lead.enrichedAt).length, 1);

  const judged = await judgedFrom(ctx);
  const stopped = await qualifyLeads(judged.deps, {}, { shouldStop: () => true });
  assert.equal(stopped.results.length, 0);
});
