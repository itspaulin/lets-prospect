import assert from 'node:assert/strict';
import test from 'node:test';
import { htmlToText, HttpSiteFetcher, isPrivateAddress, robotsAllows, usefulLinks } from './site-fetcher.js';

const html = (body: string) => `<html><head><style>p{}</style><script>var x=1</script></head><body>${body}</body></html>`;

test('extrai texto sem scripts, estilos e tags', () => {
  assert.equal(htmlToText(html('<h1>We build</h1><p>apps &amp; sites</p><!-- c -->')), 'We build apps & sites');
  assert.equal(htmlToText('We&#8217;re here &#8211; hi &#x41;'), 'We\u2019re here \u2013 hi A');
});

test('só segue links úteis do mesmo site', () => {
  const links = usefulLinks(
    html('<a href="/about">a</a><a href="/blog/x">b</a><a href="https://other.com/about">c</a><a href="/our-work/acme">d</a><a href="/brochure.pdf">e</a>'),
    new URL('https://www.acme.dev/'),
  );
  assert.deepEqual(links, ['https://www.acme.dev/about', 'https://www.acme.dev/our-work/acme']);
});

test('robots.txt: grupo do agente vence o geral e a regra mais específica vence', () => {
  assert.equal(robotsAllows('User-agent: *\nDisallow: /', '/about'), false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /\nAllow: /about', '/about'), true);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /\n\nUser-agent: prospeccao\nAllow: /', '/about'), true);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /private', '/about'), true);
  assert.equal(robotsAllows('', '/'), true);
});

test('reconhece endereços privados', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '192.168.0.9', '172.20.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:10.0.0.1']) assert.ok(isPrivateAddress(address), address);
  for (const address of ['8.8.8.8', '151.101.1.1', '2606:4700::1111']) assert.ok(!isPrivateAddress(address), address);
});

const response = (body: string, init: ResponseInit = {}) => new Response(body, { status: 200, headers: { 'content-type': 'text/html' }, ...init });

test('lê a home e as páginas úteis, respeitando robots.txt', async () => {
  const seen: string[] = [];
  const fetcher = new HttpSiteFetcher((async (input: URL | string) => {
    const url = String(input);
    seen.push(url);
    if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nDisallow: /team', { headers: { 'content-type': 'text/plain' } });
    if (url.endsWith('/about')) return response(html(`<p>About us: custom software ${'x '.repeat(100)}</p>`));
    if (url.endsWith('/team')) return response(html('<p>secret</p>'));
    return response(html('<a href="/about">About</a><a href="/team">Team</a><p>Home page</p>'));
  }) as never, async () => undefined);
  const { pages } = await fetcher.fetchSite('acme.dev');
  assert.deepEqual(pages.map((page) => page.url), ['https://acme.dev/', 'https://acme.dev/about']);
  assert.ok(!pages.some((page) => page.text.includes('secret')));
  assert.equal(seen.filter((url) => url.endsWith('/robots.txt')).length, 1);
});

test('não segue domínio que resolve para rede privada', async () => {
  let fetched = false;
  const fetcher = new HttpSiteFetcher((async () => ((fetched = true), response('x'))) as never, async () => {
    throw new Error('endereço não público');
  });
  assert.deepEqual(await fetcher.fetchSite('internal.example'), { pages: [], problem: 'endereço não público' });
  assert.equal(fetched, false);
});

test('site fora do ar devolve o motivo em vez de erro, depois de tentar de novo', async () => {
  let calls = 0;
  const fetcher = new HttpSiteFetcher((async (input: URL | string) => {
    if (!String(input).endsWith('/robots.txt')) calls++;
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  }) as never, async () => undefined);
  assert.deepEqual(await fetcher.fetchSite('down.example'), { pages: [], problem: 'erro de rede (ECONNREFUSED)' });
  assert.equal(calls, 2);
});

test('lentidão passageira: a segunda tentativa lê o site', async () => {
  let calls = 0;
  const fetcher = new HttpSiteFetcher((async (input: URL | string) => {
    if (String(input).endsWith('/robots.txt')) return new Response('', { status: 404 });
    if (++calls === 1) throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    return response(html(`<p>${'content '.repeat(40)}</p>`));
  }) as never, async () => undefined);
  assert.equal((await fetcher.fetchSite('slow.example')).pages.length, 1);
});

test('bloqueio 403 não tenta de novo e diz o motivo', async () => {
  let calls = 0;
  const fetcher = new HttpSiteFetcher((async (input: URL | string) => {
    if (String(input).endsWith('/robots.txt')) return new Response('', { status: 404 });
    calls++;
    return new Response('denied', { status: 403, headers: { 'content-type': 'text/html' } });
  }) as never, async () => undefined);
  assert.deepEqual(await fetcher.fetchSite('blocked.example'), { pages: [], problem: 'bloqueado para robôs (HTTP 403)' });
  assert.equal(calls, 1);
});

test('site renderizado por JavaScript (quase sem texto) conta como ilegível', async () => {
  const fetcher = new HttpSiteFetcher((async (input: URL | string) =>
    String(input).endsWith('/robots.txt') ? new Response('', { status: 404 }) : response(html('<div id="root"></div><h1>Bronze Labs</h1>'))) as never, async () => undefined);
  const read = await fetcher.fetchSite('spa.example');
  assert.deepEqual(read.pages, []);
  assert.match(read.problem ?? '', /JavaScript/);
});

test('não repete a mesma página com e sem barra final', async () => {
  const fetcher = new HttpSiteFetcher((async (input: URL | string) => {
    const url = String(input);
    if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
    if (url.endsWith('/about')) return new Response(null, { status: 301, headers: { location: '/about/' } });
    return response(html(`<a href="/about">a</a><a href="/about/">b</a><p>${'content '.repeat(40)}</p>`));
  }) as never, async () => undefined);
  const { pages } = await fetcher.fetchSite('acme.dev');
  assert.deepEqual(pages.map((page) => page.url), ['https://acme.dev/', 'https://acme.dev/about/']);
});

test('fetchRaw devolve o HTML bruto da home e das páginas de contato, com os links intactos', async () => {
  const seen: string[] = [];
  const fetcher = new HttpSiteFetcher((async (input: URL | string) => {
    const url = String(input);
    seen.push(url);
    if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nDisallow: /privado', { headers: { 'content-type': 'text/plain' } });
    if (url.endsWith('/contato')) return response('<a href="https://wa.me/5531999998888">Fale</a>');
    if (url.endsWith('/privado')) return response('<p>x</p>');
    return response('<a href="/contato">Contato</a><a href="/privado/contato">P</a><a href="/blog">Blog</a><p>Home</p>');
  }) as never, async () => undefined);
  const { pages } = await fetcher.fetchRaw('imob.com.br', { linkPattern: /contato/i, maxPages: 3 });
  assert.deepEqual(pages.map((page) => page.url), ['https://imob.com.br/', 'https://imob.com.br/contato']);
  assert.match(pages[1]!.html, /wa\.me\/5531999998888/);
  assert.ok(!seen.some((url) => url.endsWith('/blog')));
});

test('fetchRaw respeita o limite de páginas e devolve o motivo quando o site falha', async () => {
  const fetcher = new HttpSiteFetcher((async (input: URL | string) => {
    const url = String(input);
    if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
    return response('<a href="/contato">a</a><a href="/fale-conosco">b</a>');
  }) as never, async () => undefined);
  assert.equal((await fetcher.fetchRaw('imob.com.br', { linkPattern: /contato|fale/i, maxPages: 2 })).pages.length, 2);
  const blocked = new HttpSiteFetcher((async (input: URL | string) => (String(input).endsWith('/robots.txt') ? new Response('', { status: 404 }) : new Response('no', { status: 403 }))) as never, async () => undefined);
  assert.deepEqual(await blocked.fetchRaw('imob.com.br', { linkPattern: /contato/, maxPages: 3 }), { pages: [], problem: 'bloqueado para robôs (HTTP 403)' });
});
