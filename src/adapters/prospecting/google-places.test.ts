import assert from 'node:assert/strict';
import test from 'node:test';
import { DomainError } from '../../core/errors.js';
import { GooglePlacesClient } from './google-places.js';

const place = (id: string, extra: Record<string, unknown> = {}) => ({ id, displayName: { text: `Imob ${id}` }, internationalPhoneNumber: '+55 31 99999-8888', businessStatus: 'OPERATIONAL', ...extra });

const clientWith = (pages: unknown[], calls: { url: string; init: RequestInit }[] = []) => {
  let index = 0;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(pages[index++] ?? {}));
  }) as never;
  return new GooglePlacesClient({ apiKey: 'key', fetch: fetchImpl, baseUrl: 'https://places.test/v1' });
};

test('manda busca em português do Brasil, a chave e só os campos necessários', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const found = await clientWith([{ places: [place('a', { websiteUri: 'https://a.com.br', formattedAddress: 'Rua A, 1', rating: 4.5, userRatingCount: 30 })] }], calls).search({ text: 'imobiliária em Belo Horizonte, MG', limit: 10 });
  assert.deepEqual(found, [{ placeId: 'a', name: 'Imob a', phone: '+55 31 99999-8888', website: 'https://a.com.br', address: 'Rua A, 1', rating: 4.5, reviewCount: 30 }]);
  assert.equal(calls[0]!.url, 'https://places.test/v1/places:searchText');
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers['X-Goog-Api-Key'], 'key');
  assert.match(headers['X-Goog-FieldMask']!, /places\.internationalPhoneNumber/);
  assert.deepEqual(JSON.parse(calls[0]!.init.body as string), { textQuery: 'imobiliária em Belo Horizonte, MG', languageCode: 'pt-BR', regionCode: 'BR', pageSize: 10 });
});

test('segue as páginas até o limite e não passa dele', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const found = await clientWith(
    [
      { places: [place('1'), place('2')], nextPageToken: 't1' },
      { places: [place('3'), place('4')], nextPageToken: 't2' },
    ],
    calls,
  ).search({ text: 'x', limit: 3 });
  assert.deepEqual(found.map((item) => item.placeId), ['1', '2', '3']);
  assert.equal(JSON.parse(calls[1]!.init.body as string).pageToken, 't1');
  assert.equal(JSON.parse(calls[1]!.init.body as string).pageSize, 1);
});

test('para quando a página não traz próximo token', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const found = await clientWith([{ places: [place('1')] }], calls).search({ text: 'x', limit: 40 });
  assert.equal(found.length, 1);
  assert.equal(calls.length, 1);
});

test('descarta negócio fechado e aceita resposta sem resultados', async () => {
  const found = await clientWith([{ places: [place('open'), place('shut', { businessStatus: 'CLOSED_PERMANENTLY' })] }]).search({ text: 'x', limit: 10 });
  assert.deepEqual(found.map((item) => item.placeId), ['open']);
  assert.deepEqual(await clientWith([{}]).search({ text: 'x', limit: 10 }), []);
});

test('traduz erros do Google em mensagens acionáveis', async () => {
  const failing = (status: number, message: string) =>
    new GooglePlacesClient({ apiKey: 'k', fetch: (async () => new Response(JSON.stringify({ error: { message } }), { status })) as never });
  await assert.rejects(failing(400, 'API key not valid. Please pass a valid API key.').search({ text: 'x', limit: 1 }), (error: unknown) => error instanceof DomainError && /GOOGLE_PLACES_API_KEY/.test(error.message));
  await assert.rejects(failing(403, 'Places API (New) has not been used').search({ text: 'x', limit: 1 }), (error: unknown) => error instanceof DomainError && /403/.test(error.message));
  await assert.rejects(failing(429, 'quota').search({ text: 'x', limit: 1 }), (error: unknown) => error instanceof DomainError && /429/.test(error.message));
});
