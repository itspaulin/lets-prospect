import assert from 'node:assert/strict';
import test from 'node:test';
import { extractWhatsapp, pickWhatsapp } from './whatsapp.js';

const numbers = (html: string) => extractWhatsapp(html).map((item) => item.phone.e164);

test('acha o número nos formatos de link do WhatsApp', () => {
  assert.deepEqual(numbers('<a href="https://wa.me/5531999998888">Fale</a>'), ['+5531999998888']);
  assert.deepEqual(numbers('<a href="https://api.whatsapp.com/send?phone=5531988887777&text=Oi">Fale</a>'), ['+5531988887777']);
  assert.deepEqual(numbers('<a href="https://api.whatsapp.com/send/?text=Oi&amp;phone=5531977776666">Fale</a>'), ['+5531977776666']);
  assert.deepEqual(numbers('<a href="https://web.whatsapp.com/send?phone=%2B5531966665555">Fale</a>'), ['+5531966665555']);
  assert.deepEqual(numbers('<a href="whatsapp://send?phone=5531955554444">Fale</a>'), ['+5531955554444']);
});

test('acha número escrito perto da palavra WhatsApp, ignorando tags', () => {
  assert.deepEqual(numbers('<p>WhatsApp: <b>(31) 99999-8888</b></p>'), ['+5531999998888']);
  assert.deepEqual(numbers('<span>Whats App +55 31 98888-7777</span>'), ['+5531988887777']);
});

test('link wa.me/message não tem número, e número que não é do Brasil não conta', () => {
  assert.deepEqual(numbers('<a href="https://wa.me/message/ABCDEF123">Fale</a>'), []);
  assert.deepEqual(numbers('<a href="https://wa.me/14155552671">Call</a>'), []);
  assert.deepEqual(numbers('<p>Telefone (31) 99999-8888</p>'), []);
});

test('link vem antes do texto e o mesmo número não repete', () => {
  const html = '<p>WhatsApp (31) 98888-7777</p><a href="https://wa.me/5531999998888">x</a><a href="https://wa.me/5531999998888">y</a>';
  assert.deepEqual(extractWhatsapp(html).map((item) => [item.phone.e164, item.via]), [['+5531999998888', 'link'], ['+5531988887777', 'text']]);
});

test('script e estilo não geram falso positivo', () => {
  assert.deepEqual(numbers('<script>var s = "WhatsApp (31) 99999-8888"</script>'), []);
});

test('prefere celular a fixo', () => {
  const found = extractWhatsapp('<a href="https://wa.me/553133334444">fixo</a><a href="https://wa.me/5531999998888">cel</a>');
  assert.equal(pickWhatsapp(found)?.phone.e164, '+5531999998888');
  assert.equal(pickWhatsapp(extractWhatsapp('<a href="https://wa.me/553133334444">fixo</a>'))?.phone.kind, 'landline');
  assert.equal(pickWhatsapp([]), undefined);
});
