// Opt-out service for the cold e-mails. Pure request handler (no Cloudflare imports) so it runs under node:test.
// Only a hash of the address is ever stored. A GET never unsubscribes anyone: mail scanners open links on their
// own, so the person confirms with a button (POST). Mail clients doing RFC 8058 one-click also POST.

export interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  list(options: { prefix: string; cursor?: string; limit?: number }): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }>;
}

export type Env = { OPTOUTS: KV; SECRET: string; API_TOKEN: string };

const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer): string => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

// Must stay identical to `signHash` in src/adapters/unsubscribe/worker-unsubscribe.ts.
export const sign = async (secret: string, hash: string): Promise<string> => {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(hash)));
};

const constantTimeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

const page = (title: string, body: string, status = 200): Response =>
  new Response(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>` +
      `<style>body{font-family:system-ui,sans-serif;max-width:30rem;margin:15vh auto;padding:0 1.25rem;color:#1a1a1a;line-height:1.5}button{font:inherit;padding:.7rem 1.2rem;border:0;border-radius:.4rem;background:#1a1a1a;color:#fff;cursor:pointer}</style></head>` +
      `<body><h1>${title}</h1>${body}</body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } },
  );

const HASH = /^[0-9a-f]{64}$/;

const verified = async (url: URL, env: Env): Promise<string | undefined> => {
  const hash = url.searchParams.get('e') ?? '';
  const signature = url.searchParams.get('s') ?? '';
  if (!HASH.test(hash) || !constantTimeEqual(signature, await sign(env.SECRET, hash))) return undefined;
  return hash;
};

export const handle = async (request: Request, env: Env, now: () => Date = () => new Date()): Promise<Response> => {
  const url = new URL(request.url);

  if (url.pathname === '/api/optouts') {
    if (request.method !== 'GET') return new Response('method not allowed', { status: 405 });
    if (!constantTimeEqual(request.headers.get('authorization') ?? '', `Bearer ${env.API_TOKEN}`)) return new Response('unauthorized', { status: 401 });
    const cursor = url.searchParams.get('cursor') ?? undefined;
    const listed = await env.OPTOUTS.list({ prefix: 'u:', cursor, limit: 500 });
    const items = await Promise.all(listed.keys.map(async (key) => ({ hash: key.name.slice(2), at: (await env.OPTOUTS.get(key.name)) ?? '' })));
    return Response.json({ items, next: listed.list_complete ? null : (listed.cursor ?? null) }, { headers: { 'cache-control': 'no-store' } });
  }

  if (url.pathname === '/d') {
    const hash = await verified(url, env);
    if (!hash) return page('Link inválido', '<p>Este link não é válido. Se quiser deixar de receber mensagens, é só responder o e-mail pedindo para parar.</p>', 400);
    if (request.method === 'GET')
      return page(
        'Deixar de receber mensagens',
        `<p>Confirme para eu não escrever mais para este endereço.</p><form method="post" action="${url.pathname}${url.search.replace(/&/g, '&amp;')}"><button type="submit">Confirmar</button></form>`,
      );
    if (request.method === 'POST') {
      const key = `u:${hash}`;
      if (!(await env.OPTOUTS.get(key))) await env.OPTOUTS.put(key, now().toISOString());
      return page('Pronto', '<p>Este endereço não receberá mais mensagens minhas. Obrigado, e desculpe o incômodo.</p>');
    }
    return new Response('method not allowed', { status: 405 });
  }

  return page('Não encontrado', '', 404);
};
