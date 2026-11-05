import type { Deps } from '../ports/runtime.js';
import { DomainError } from '../errors.js';
import { hashValue } from '../rules/render.js';
import { recordReply } from './replies.js';
import { nowIso } from './shared.js';

export type OptOutSync = { checked: number; applied: number };

// Pulls the people who clicked the opt-out link and applies the same effects as an "unsubscribe" reply:
// pending messages cancelled, address suppressed for good, company closed. Fails closed: if the service
// cannot be reached, the caller must not send, because someone may have opted out meanwhile.
export const syncOptOuts = async (deps: Deps): Promise<OptOutSync> => {
  if (!deps.unsubscribe) return { checked: 0, applied: 0 };
  let items;
  try {
    items = await deps.unsubscribe.fetchOptOuts();
  } catch (error) {
    throw new DomainError('validation', `Não consegui conferir os descadastros (${error instanceof Error ? error.message : String(error)}). Nada foi enviado.`);
  }
  const fresh = items.filter((item) => /^[0-9a-f]{64}$/.test(item.hash) && !deps.store.suppressions.has('email', item.hash));
  if (fresh.length === 0) return { checked: items.length, applied: 0 };
  const contacts = deps.store.contacts.all().filter((contact) => contact.email);
  for (const item of fresh) {
    const owner = contacts.find((contact) => hashValue(contact.email!) === item.hash);
    if (owner) recordReply(deps, owner.id, { category: 'unsubscribe', summary: 'clicou no link de descadastro' });
    else deps.store.suppressions.insert({ id: deps.newId(), kind: 'email', valueHash: item.hash, reason: 'clicou no link de descadastro', createdAt: nowIso(deps) });
  }
  return { checked: items.length, applied: fresh.length };
};
