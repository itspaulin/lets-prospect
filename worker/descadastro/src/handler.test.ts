import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { signHash } from '../../../src/adapters/unsubscribe/worker-unsubscribe.js';
import { handle, sign, type Env, type KV } from './handler.js';

class MemoryKV implements KV {
  readonly data = new Map<string, string>();
  async get(key: string) {
    return this.data.get(key) ?? null;
  }
  async put(key: string, value: string) {
    this.data.set(key, value);
  }
  async list({ prefix, cursor, limit = 1000 }: { prefix: string; cursor?: string; limit?: number }) {
    const names = [...this.data.keys()].filter((name) => name.startsWith(prefix)).sort();
    const start = cursor ? Number(cursor) : 0;
    const slice = names.slice(start, start + limit);
    const done = start + limit >= names.length;
    return { keys: slice.map((name) => ({ name })), list_complete: done, cursor: done ? undefined : String(start + limit) };
  }
}

const SECRET = 'segredo-de-teste';
const hash = createHash('sha256').update('pessoa@empresa.com.br').digest('hex');
const env = (): Env => ({ OPTOUTS: new MemoryKV(), SECRET, API_TOKEN: 'token-da-api' });
const link = async (path = '/d') => `https://x.test${path}?e=${hash}&s=${await sign(SECRET, hash)}`;
const NOW = () => new Date('2026-11-10T12:00:00.000Z');

test('assinatura do Worker é igual à do app', async () => {
  assert.equal(await sign(SECRET, hash), signHash(SECRET, hash));
});

test('GET mostra a confirmação e NÃO descadastra', async () => {
  const e = env();
  const response = await handle(new Request(await link()), e, NOW);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<form method="post"/);
  assert.equal((e.OPTOUTS as MemoryKV).data.size, 0);
});

test('POST (botão ou um clique do Gmail) grava só o hash e a data', async () => {
  const e = env();
  const response = await handle(new Request(await link(), { method: 'POST', body: 'List-Unsubscribe=One-Click', headers: { 'content-type': 'application/x-www-form-urlencoded' } }), e, NOW);
  assert.equal(response.status, 200);
  assert.deepEqual([...(e.OPTOUTS as MemoryKV).data], [[`u:${hash}`, '2026-11-10T12:00:00.000Z']]);
});

test('clicar duas vezes não muda a data original', async () => {
  const e = env();
  await handle(new Request(await link(), { method: 'POST' }), e, NOW);
  await handle(new Request(await link(), { method: 'POST' }), e, () => new Date('2026-12-01T00:00:00.000Z'));
  assert.equal((e.OPTOUTS as MemoryKV).data.get(`u:${hash}`), '2026-11-10T12:00:00.000Z');
});

test('assinatura errada, hash malformado ou parâmetros ausentes são recusados', async () => {
  const e = env();
  for (const url of [`https://x.test/d?e=${hash}&s=${'0'.repeat(64)}`, `https://x.test/d?e=abc&s=${await sign(SECRET, 'abc')}`, 'https://x.test/d']) {
    const response = await handle(new Request(url, { method: 'POST' }), e, NOW);
    assert.equal(response.status, 400);
  }
  assert.equal((e.OPTOUTS as MemoryKV).data.size, 0);
});

test('a lista de descadastros exige o token e devolve os itens com paginação', async () => {
  const e = env();
  await handle(new Request(await link(), { method: 'POST' }), e, NOW);
  assert.equal((await handle(new Request('https://x.test/api/optouts'), e)).status, 401);
  assert.equal((await handle(new Request('https://x.test/api/optouts', { headers: { authorization: 'Bearer errado' } }), e)).status, 401);
  const response = await handle(new Request('https://x.test/api/optouts', { headers: { authorization: 'Bearer token-da-api' } }), e);
  assert.deepEqual(await response.json(), { items: [{ hash, at: '2026-11-10T12:00:00.000Z' }], next: null });
});

test('rota desconhecida dá 404', async () => {
  assert.equal((await handle(new Request('https://x.test/qualquer'), env())).status, 404);
});
