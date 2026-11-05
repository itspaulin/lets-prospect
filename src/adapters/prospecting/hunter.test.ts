import assert from 'node:assert/strict';
import test from 'node:test';
import { DomainError } from '../../core/errors.js';
import { HunterClient } from './hunter.js';

const reply = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });
const client = (fetchImpl: typeof fetch) => new HunterClient({ apiKey: 'key', fetch: fetchImpl, baseUrl: 'https://hunter.test/v2' });

const discoverCall = async (query: Parameters<HunterClient['discover']>[0]) => {
  let call: { url: string; init: RequestInit } | undefined;
  const hunter = client((async (url: string, init: RequestInit) => {
    call = { url, init };
    return new Response(JSON.stringify({ data: [{ domain: 'acme.dev', organization: 'Acme', emails_count: { personal: 4, generic: 1, total: 5 } }, { domain: 'bare.io', organization: null }] }));
  }) as never);
  const found = await hunter.discover(query);
  return { found, call: call!, body: JSON.parse(call!.init.body as string) };
};

test('discover manda filtros estruturados: local, setor de serviços, tamanho e palavras-chave', async () => {
  const { found, call, body } = await discoverCall({ country: 'US', state: 'NY', city: 'New York', headcount: ['11-50'], keywords: ['software agency'], limit: 500 });
  assert.deepEqual(found, [{ domain: 'acme.dev', name: 'Acme', personalEmails: 4 }, { domain: 'bare.io', name: 'bare.io', personalEmails: undefined }]);
  assert.equal(call.url, 'https://hunter.test/v2/discover');
  assert.equal((call.init.headers as Record<string, string>)['X-API-KEY'], 'key');
  assert.deepEqual(body, {
    headquarters_location: { include: [{ country: 'US', state: 'NY', city: 'New York' }] },
    industry: { include: ['IT Services and IT Consulting', 'Software Development'] },
    headcount: ['11-50'],
    keywords: { include: ['software agency'], match: 'any' },
    limit: 100,
  });
});

test('discover só com país não manda estado nem cidade', async () => {
  const { body } = await discoverCall({ country: 'GB', keywords: [], limit: 10 });
  assert.deepEqual(body.headquarters_location, { include: [{ country: 'GB' }] });
  assert.equal(body.keywords, undefined);
});

test('erro do Hunter mostra o detalhe em vez do JSON cru', async () => {
  const body = { errors: [{ id: 'x', code: 400, details: 'You must specify a state when filtering on city in the US.' }] };
  await assert.rejects(client(reply(body, 400) as never).discover({ country: 'US', city: 'New York', keywords: [], limit: 5 }), /You must specify a state/);
});

test('domain search pede só pessoas seniores e mapeia o contato', async () => {
  let url = '';
  const hunter = client((async (input: string) => {
    url = input;
    return new Response(
      JSON.stringify({
        data: {
          emails: [
            { value: 'jane@acme.dev', confidence: 94, first_name: 'Jane', last_name: 'Doe', position: 'CTO', sources: [{ uri: 'https://acme.dev/team' }], verification: { status: 'valid' } },
            { value: 'x@acme.dev', first_name: null, last_name: null, position: null, sources: null, verification: null },
          ],
        },
      }),
    );
  }) as never);
  const [jane, anon] = await hunter.findDecisionMakers('acme.dev', { limit: 2 });
  assert.match(url, /type=personal/);
  assert.match(url, /seniority=senior%2Cexecutive/);
  assert.deepEqual(jane, { email: 'jane@acme.dev', name: 'Jane Doe', role: 'CTO', confidence: 94, verification: 'valid', sources: ['https://acme.dev/team'] });
  assert.equal(anon?.name, '');
  assert.equal(anon?.verification, 'unknown');
});

test('lê o saldo de créditos', async () => {
  const hunter = client(reply({ data: { requests: { credits: { used: 5, available: 50, remaining: 45 } } } }) as never);
  assert.equal(await hunter.creditsRemaining(), 45);
});

test('traduz erros do provedor', async () => {
  const code = (error: unknown) => error instanceof DomainError && error.code === 'provider_error';
  await assert.rejects(client(reply({}, 401) as never).creditsRemaining(), code);
  await assert.rejects(client(reply({}, 429) as never).creditsRemaining(), code);
  await assert.rejects(client(reply({ data: 'lixo' }) as never).creditsRemaining(), (error) => code(error) && /inesperada/.test((error as Error).message));
});
