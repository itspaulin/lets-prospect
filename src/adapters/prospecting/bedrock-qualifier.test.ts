import assert from 'node:assert/strict';
import test from 'node:test';
import { DomainError } from '../../core/errors.js';
import { BedrockQualifier } from './bedrock-qualifier.js';

const input = { company: { name: 'Acme', domain: 'acme.dev', country: 'GB' }, pages: [{ url: 'https://acme.dev/', text: 'We build software.' }] };
const make = (fetchImpl: unknown) => new BedrockQualifier({ token: 'tok', region: 'us-east-1', modelId: 'anthropic.claude-haiku-5-5', fetch: fetchImpl as typeof fetch, baseUrl: 'https://bedrock.test' });

test('chama o Converse com token e força a ferramenta de relatório', async () => {
  let call: { url: string; init: RequestInit } | undefined;
  const qualifier = make(async (url: string, init: RequestInit) => {
    call = { url, init };
    const toolUse = { input: { verdict: 'software_house', reason: 'ok', findings: [{ kind: 'business_model', stance: 'supports', claim: 'c', quote: 'We build software.', page_url: 'https://acme.dev/' }], technologies: ['React'] } };
    return new Response(JSON.stringify({ output: { message: { content: [{ toolUse }] } } }));
  });
  const verdict = await qualifier.qualify(input);
  assert.equal(call?.url, 'https://bedrock.test/model/anthropic.claude-haiku-5-5/converse');
  assert.equal((call?.init.headers as Record<string, string>).Authorization, 'Bearer tok');
  const body = JSON.parse(call!.init.body as string);
  assert.deepEqual(body.toolConfig.toolChoice, { tool: { name: 'report' } });
  assert.match(body.messages[0].content[0].text, /=== PAGE https:\/\/acme\.dev\//);
  assert.equal(verdict.verdict, 'software_house');
  assert.equal(verdict.findings[0]?.pageUrl, 'https://acme.dev/');
});

test('erro HTTP e resposta fora do formato viram provider_error', async () => {
  const code = (error: unknown) => error instanceof DomainError && error.code === 'provider_error';
  await assert.rejects(make(async () => new Response('denied', { status: 403 })).qualify(input), code);
  await assert.rejects(make(async () => new Response(JSON.stringify({ output: { message: { content: [{ text: 'oi' }] } } }))).qualify(input), code);
});

test('segment nulo não derruba a resposta, e um campo inválido é nomeado no erro', async () => {
  const reply = (input: unknown) => async () => new Response(JSON.stringify({ output: { message: { content: [{ toolUse: { input } }] } } }));
  const verdict = await make(reply({ verdict: 'not_a_fit', segment: null, reason: 'produto próprio', findings: [], technologies: [] })).qualify(input);
  assert.equal(verdict.segment, undefined);
  await assert.rejects(make(reply({ verdict: 'talvez', reason: 'x', findings: [], technologies: [] })).qualify(input), (error: unknown) => error instanceof DomainError && /verdict/.test(error.message));
});

test('o modelo confunde veredito com tipo: "it_consultancy" no veredito vira alvo, e tipo inventado é descartado', async () => {
  const reply = (body: unknown) => async () => new Response(JSON.stringify({ output: { message: { content: [{ toolUse: { input: body } }] } } }));
  const consultancy = await make(reply({ verdict: 'it_consultancy', reason: 'consultoria', findings: [], technologies: [] })).qualify(input);
  assert.deepEqual([consultancy.verdict, consultancy.segment], ['software_house', 'it_consultancy']);
  const invented = await make(reply({ verdict: 'not_a_fit', segment: 'product_company', reason: 'produto', findings: [], technologies: [] })).qualify(input);
  assert.deepEqual([invented.verdict, invented.segment], ['not_a_fit', undefined]);
});
