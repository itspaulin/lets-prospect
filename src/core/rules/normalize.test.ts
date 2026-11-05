import assert from 'node:assert/strict';
import test from 'node:test';
import { DomainError } from '../errors.js';
import { belongsToDomain, normalizeCompanyName, normalizeCountry, normalizeDomain, normalizeEmail, normalizeTechnologies } from './normalize.js';

test('normaliza domínio removendo protocolo, www, caminho e caixa', () => {
  assert.equal(normalizeDomain('HTTPS://WWW.Acme.DEV/about?x=1'), 'acme.dev');
  assert.equal(normalizeDomain('acme.co.uk'), 'acme.co.uk');
});

test('rejeita site sem domínio válido', () => {
  assert.throws(() => normalizeDomain('localhost'), DomainError);
  assert.throws(() => normalizeDomain('não é site'), DomainError);
});

test('normaliza e valida e-mail', () => {
  assert.equal(normalizeEmail('  Jane@Acme.DEV '), 'jane@acme.dev');
  assert.throws(() => normalizeEmail('jane@'), DomainError);
});

test('aceita apelidos de país e exige ISO de 2 letras', () => {
  assert.equal(normalizeCountry('uk'), 'GB');
  assert.equal(normalizeCountry('us'), 'US');
  assert.equal(normalizeCountry('Brasil'), 'BR');
  assert.throws(() => normalizeCountry('England'), DomainError);
});

test('nome normalizado ignora sufixos societários e pontuação', () => {
  assert.equal(normalizeCompanyName('Acme Software Ltd.'), normalizeCompanyName('ACME software, LLC'));
});

test('subdomínio pertence ao domínio, domínio parecido não', () => {
  assert.equal(belongsToDomain('mail.acme.dev', 'acme.dev'), true);
  assert.equal(belongsToDomain('notacme.dev', 'acme.dev'), false);
});

test('tecnologias sem duplicadas por caixa', () => {
  assert.deepEqual(normalizeTechnologies(['React', 'react', ' Node.js ', '']), ['React', 'Node.js']);
});
