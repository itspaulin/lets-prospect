import assert from 'node:assert/strict';
import test from 'node:test';
import { DomainError } from '../errors.js';
import { assertTransition } from './company-status.js';

const rejects = (fn: () => void, pattern: RegExp) => assert.throws(fn, (error) => error instanceof DomainError && pattern.test(error.message));

test('permite o fluxo principal', () => {
  assertTransition('identified', 'qualified');
  assertTransition('qualified', 'contacted');
  assertTransition('contacted', 'replied');
  assertTransition('replied', 'interested');
  assertTransition('interested', 'opportunity');
  assertTransition('opportunity', 'converted');
});

test('bloqueia saltos inconsistentes', () => {
  rejects(() => assertTransition('identified', 'contacted'), /não permitida/);
  rejects(() => assertTransition('disqualified', 'qualified'), /não permitida/);
  rejects(() => assertTransition('qualified', 'qualified'), /já está/);
});

test('estados de encerramento exigem motivo', () => {
  rejects(() => assertTransition('identified', 'disqualified'), /--reason/);
  rejects(() => assertTransition('contacted', 'do_not_contact', { reason: '  ' }), /--reason/);
  assertTransition('contacted', 'do_not_contact', { reason: 'pediu para parar' });
});

test('do_not_contact não volta para a fila', () => {
  rejects(() => assertTransition('do_not_contact', 'qualified', { reason: 'x', override: true }), /do_not_contact/);
  rejects(() => assertTransition('do_not_contact', 'inactive', { reason: 'engano' }), /--override/);
  assertTransition('do_not_contact', 'inactive', { reason: 'marcado por engano', override: true });
});
