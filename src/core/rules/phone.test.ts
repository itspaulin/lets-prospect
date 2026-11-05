import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeBrazilPhone } from './phone.js';

test('celular em formato internacional, nacional e só com dígitos vira o mesmo E.164', () => {
  for (const raw of ['+55 31 99999-8888', '(31) 99999-8888', '31999998888', '0 31 99999-8888', '5531999998888']) {
    assert.deepEqual(normalizeBrazilPhone(raw), { e164: '+5531999998888', kind: 'mobile' }, raw);
  }
});

test('fixo é reconhecido como fixo', () => {
  assert.deepEqual(normalizeBrazilPhone('+55 31 3333-4444'), { e164: '+553133334444', kind: 'landline' });
  assert.deepEqual(normalizeBrazilPhone('(31) 3333-4444'), { e164: '+553133334444', kind: 'landline' });
});

test('DDD 55 não é confundido com o código do país', () => {
  assert.deepEqual(normalizeBrazilPhone('(55) 99999-8888'), { e164: '+5555999998888', kind: 'mobile' });
  assert.deepEqual(normalizeBrazilPhone('(55) 3333-4444'), { e164: '+555533334444', kind: 'landline' });
});

test('0800, número curto, DDD inválido e número de outro país são recusados', () => {
  for (const raw of ['0800 722 0000', '190', '(01) 99999-8888', '(10) 99999-8888', '+1 415 555 2671', '', 'sem telefone']) {
    assert.equal(normalizeBrazilPhone(raw), undefined, raw);
  }
});

test('celular antigo de 8 dígitos, sem o 9 na frente, ganha o 9', () => {
  assert.deepEqual(normalizeBrazilPhone('553199644455'), { e164: '+5531999644455', kind: 'mobile' });
  assert.deepEqual(normalizeBrazilPhone('(31) 9964-4455'), { e164: '+5531999644455', kind: 'mobile' });
  assert.deepEqual(normalizeBrazilPhone('3199644455'), { e164: '+5531999644455', kind: 'mobile' });
});
