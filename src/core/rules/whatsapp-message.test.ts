import assert from 'node:assert/strict';
import test from 'node:test';
import { DomainError } from '../errors.js';
import { assertWhatsappPlaceholders, renderWhatsapp, shortName } from './whatsapp-message.js';

test('nome curto corta o título do Google no separador e tira parênteses', () => {
  assert.equal(shortName('Liderar Imóveis BH - Imobiliária Belo Horizonte'), 'Liderar Imóveis BH');
  assert.equal(shortName('Silvio Ximenes | Imobiliária em BH'), 'Silvio Ximenes');
  assert.equal(shortName('Liberdade Imóveis (Liberdade Negócios Imobiliários Ltda) - Belo Horizonte'), 'Liberdade Imóveis');
  assert.equal(shortName('Valore Imóveis'), 'Valore Imóveis');
  assert.equal(shortName('Real-State Imóveis'), 'Real-State Imóveis');
});

test('a abertura usa o apelido de quem envia, e cai para o nome quando não há apelido', () => {
  const text = 'Aqui é o {{sender.nickname}} ({{sender.name}}). Vi a {{lead.shortName}}.';
  assert.equal(renderWhatsapp(text, { lead: { name: 'Valore Imóveis - BH' }, sender: { name: 'Maria Souza', nickname: 'Maria' } }), 'Aqui é o Maria (Maria Souza). Vi a Valore Imóveis.');
  assert.equal(renderWhatsapp('Aqui é o {{sender.nickname}}.', { lead: { name: 'X' }, sender: { name: 'Maria Souza', nickname: '' } }), 'Aqui é o Maria Souza.');
});

test('placeholder desconhecido ou sem valor é recusado com mensagem clara', () => {
  assert.throws(() => assertWhatsappPlaceholders('Oi {{lead.cnpj}}'), (error: unknown) => error instanceof DomainError && /Placeholder desconhecido/.test(error.message));
  assert.throws(() => renderWhatsapp('Aqui é o {{sender.nickname}}', { lead: { name: 'X' }, sender: { name: '', nickname: '' } }), (error: unknown) => error instanceof DomainError && /SENDER_NAME/.test(error.message));
});
