import type { CompanyStatus } from '../entities/company.js';
import { DomainError } from '../errors.js';

const TRANSITIONS: Record<CompanyStatus, readonly CompanyStatus[]> = {
  identified: ['qualified', 'disqualified', 'inactive', 'do_not_contact'],
  qualified: ['contacted', 'identified', 'disqualified', 'inactive', 'do_not_contact'],
  disqualified: ['identified', 'do_not_contact'],
  contacted: ['replied', 'not_interested', 'inactive', 'do_not_contact'],
  replied: ['interested', 'not_interested', 'inactive', 'do_not_contact'],
  interested: ['opportunity', 'not_interested', 'inactive', 'do_not_contact'],
  opportunity: ['converted', 'interested', 'not_interested', 'inactive', 'do_not_contact'],
  converted: ['inactive', 'do_not_contact'],
  not_interested: ['inactive', 'do_not_contact'],
  inactive: ['identified', 'qualified', 'do_not_contact'],
  do_not_contact: [],
};

export const REASON_REQUIRED: ReadonlySet<CompanyStatus> = new Set(['disqualified', 'not_interested', 'do_not_contact', 'inactive']);

export type TransitionOptions = { reason?: string; override?: boolean };

export const allowedTransitions = (from: CompanyStatus): readonly CompanyStatus[] => TRANSITIONS[from];

// Leaving do_not_contact is never part of the normal flow: it needs an explicit override with a reason
// and can only go to inactive, so the company never lands straight back in a sending queue.
export const assertTransition = (from: CompanyStatus, to: CompanyStatus, options: TransitionOptions = {}): void => {
  const reason = options.reason?.trim();
  if (from === to) throw new DomainError('invalid_transition', `Empresa já está em ${to}`);
  if (from === 'do_not_contact') {
    if (!options.override || to !== 'inactive' || !reason)
      throw new DomainError('invalid_transition', 'do_not_contact só pode ir para inactive, com --override e --reason');
    return;
  }
  if (!TRANSITIONS[from].includes(to))
    throw new DomainError('invalid_transition', `Transição ${from} -> ${to} não permitida. Permitidas: ${TRANSITIONS[from].join(', ') || 'nenhuma'}`);
  if (REASON_REQUIRED.has(to) && !reason) throw new DomainError('invalid_transition', `Transição para ${to} exige --reason`);
};

export const isOutreachClosed = (status: CompanyStatus): boolean =>
  status === 'do_not_contact' || status === 'not_interested' || status === 'disqualified' || status === 'converted';
