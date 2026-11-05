import assert from 'node:assert/strict';
import test from 'node:test';
import type { OptOut, Unsubscribe } from '../ports/unsubscribe.js';
import { hashValue } from '../rules/render.js';
import { outreachSetup } from '../../testing/outreach.js';
import { DomainError } from '../errors.js';
import { approveMessage, draftMessage } from './messages.js';
import { syncOptOuts } from './optouts.js';
import { sendApproved } from './send.js';

class FakeUnsubscribe implements Unsubscribe {
  optOuts: OptOut[] = [];
  fail = false;
  url(email: string) {
    return `https://sair.example/d?e=${hashValue(email)}&s=assinatura`;
  }
  async fetchOptOuts() {
    if (this.fail) throw new Error('fora do ar');
    return this.optOuts;
  }
}

const withLink = () => {
  const context = outreachSetup();
  const unsubscribe = new FakeUnsubscribe();
  context.deps.unsubscribe = unsubscribe;
  context.deps.sending = { ...context.deps.sending, footerWithLink: '{{sender.name}}\n\nPara sair da lista: {{unsubscribeUrl}}' };
  return { ...context, unsubscribe };
};

test('rodapé ganha o link pessoal e o envio manda o cabeçalho de um clique', async () => {
  const context = withLink();
  const message = draftMessage(context.deps, context.campaign, { companyRef: 'acme.dev' });
  assert.match(message.body, new RegExp(`Para sair da lista: https://sair.example/d\\?e=${hashValue('jane@acme.dev')}`));
  approveMessage(context.deps, message.id);
  await sendApproved(context.deps, context.campaign);
  const header = context.email.sent[0]!.headers;
  assert.match(header['List-Unsubscribe']!, /^<https:\/\/sair\.example\/d\?e=[0-9a-f]{64}&s=assinatura>, <mailto:/);
  assert.equal(header['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
});

test('sem o serviço configurado nada muda: rodapé antigo e mailto', async () => {
  const context = outreachSetup();
  const message = draftMessage(context.deps, context.campaign, { companyRef: 'acme.dev' });
  assert.doesNotMatch(message.body, /sair\.example/);
  approveMessage(context.deps, message.id);
  await sendApproved(context.deps, context.campaign);
  assert.equal(context.email.sent[0]!.headers['List-Unsubscribe'], '<mailto:maria@example.dev?subject=unsubscribe>');
  assert.equal(context.email.sent[0]!.headers['List-Unsubscribe-Post'], undefined);
});

test('quem clicou no link é suprimido, a mensagem pendente é cancelada e o envio não sai', async () => {
  const context = withLink();
  const message = approveMessage(context.deps, draftMessage(context.deps, context.campaign, { companyRef: 'acme.dev' }).id);
  context.unsubscribe.optOuts = [{ hash: hashValue('jane@acme.dev'), at: '2026-10-26T13:00:00.000Z' }];
  const report = await sendApproved(context.deps, context.campaign);
  assert.equal(context.email.sent.length, 0);
  assert.equal(context.deps.store.messages.findById(message.id)!.status, 'cancelled');
  assert.equal(context.deps.store.suppressions.has('email', hashValue('jane@acme.dev')), true);
  assert.equal(context.deps.store.companies.findByDomain('acme.dev')!.status, 'do_not_contact');
  assert.equal(report.outcomes.length, 0);
});

test('sincronizar duas vezes não repete e hash desconhecido vira supressão simples', async () => {
  const context = withLink();
  const stranger = hashValue('ninguem@outro.com');
  context.unsubscribe.optOuts = [{ hash: stranger, at: 'x' }];
  assert.deepEqual(await syncOptOuts(context.deps), { checked: 1, applied: 1 });
  assert.deepEqual(await syncOptOuts(context.deps), { checked: 1, applied: 0 });
  assert.equal(context.deps.store.suppressions.has('email', stranger), true);
  context.unsubscribe.optOuts = [{ hash: 'lixo', at: 'x' }];
  assert.deepEqual(await syncOptOuts(context.deps), { checked: 1, applied: 0 });
});

test('se não der para conferir os descadastros, nada é enviado', async () => {
  const context = withLink();
  approveMessage(context.deps, draftMessage(context.deps, context.campaign, { companyRef: 'acme.dev' }).id);
  context.unsubscribe.fail = true;
  await assert.rejects(() => sendApproved(context.deps, context.campaign), (error) => error instanceof DomainError && /Nada foi enviado/.test(error.message));
  assert.equal(context.email.sent.length, 0);
});
