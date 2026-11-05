import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestDeps } from '../testing/deps.js';
import { runCli } from './run.js';

const harness = () => {
  const { deps } = createTestDeps();
  const out: string[] = [];
  const err: string[] = [];
  const answers: string[] = [];
  const run = (...argv: string[]) =>
    runCli(argv, { out: (line) => out.push(line), err: (line) => err.push(line), prompt: async () => answers.shift() ?? '', edit: async (text) => text }, () => deps);
  return { deps, out, err, run, answers };
};

test('fluxo de cadastro, evidência, qualificação e histórico pela CLI', async () => {
  const { run, out, deps } = harness();
  assert.equal(await run('company', 'add', '--name', 'Acme', '--website', 'acme.dev', '--country', 'us', '--tech', 'React,Node.js', '--employees', '12'), 0);
  assert.match(out.join('\n'), /sem --source/);
  assert.equal(await run('evidence', 'add', 'acme.dev', '--kind', 'business_model', '--claim', 'agência', '--certainty', 'verified', '--source', 'https://acme.dev'), 0);
  assert.equal(await run('company', 'status', 'acme.dev', 'qualified'), 0);
  assert.equal(await run('company', 'update', 'acme.dev', '--employees', ''), 0);
  assert.equal(deps.store.companies.findByDomain('acme.dev')!.employeeCount, undefined);
  out.length = 0;
  assert.equal(await run('company', 'show', 'acme.dev'), 0);
  assert.match(out.join('\n'), /identified -> qualified/);
});

test('erros de uso retornam código 1 com mensagem, sem exceção', async () => {
  const { run, err } = harness();
  assert.equal(await run('company', 'show', 'nada.dev'), 1);
  assert.equal(await run('company', 'add', '--nome', 'x'), 1);
  assert.equal(await run('company', 'status', 'nada.dev', 'feliz'), 1);
  assert.equal(await run('company', 'add', '--name', 'X', '--website', 'x.dev', '--country', 'US', '--employees', 'dez'), 1);
  assert.equal(err.length, 4);
  assert.ok(err.every((line) => line.startsWith('Erro: ')));
});

test('ajuda sem comando', async () => {
  const { run, out } = harness();
  assert.equal(await run(), 0);
  assert.match(out[0]!, /Uso:/);
  assert.equal(await run('voar'), 1);
});

test('campanha de teste completa pela CLI, do cadastro ao relatório', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'prospeccao-test-'));
  const body = join(dir, 'body.txt');
  writeFileSync(body, 'Hi {{contact.firstName}},\n\n{{reason}}\n\nI help agencies with {{stack}} work. Open to a chat?');

  const { run, out, err, answers, deps } = harness();
  const ok = async (...argv: string[]) => assert.equal(await run(...argv), 0, `${argv.join(' ')}\n${err.join('\n')}`);
  await ok('company', 'add', '--name', 'Acme', '--website', 'acme.dev', '--country', 'GB', '--employees', '15', '--tech', 'React;Node.js', '--source', 'https://clutch.co/acme');
  await ok('evidence', 'add', 'acme.dev', '--kind', 'business_model', '--claim', 'client case studies', '--certainty', 'verified', '--source', 'https://acme.dev/work');
  await ok('contact', 'add', 'acme.dev', '--name', 'Jane Doe', '--role', 'CTO', '--email', 'jane@acme.dev', '--source', 'https://acme.dev/team');
  await ok('company', 'status', 'acme.dev', 'qualified');
  await ok('campaign', 'create', 'teste', '--market', 'GB');
  await ok('campaign', 'template', 'teste', '--step', '0', '--subject', 'Extra hands for {{company.name}}', '--file', body);
  assert.equal(await run('campaign', 'activate', 'teste'), 1);
  answers.push('s');
  await ok('campaign', 'approve-template', 'teste');
  await ok('campaign', 'activate', 'teste');
  await ok('campaign', 'select', 'teste');
  await ok('message', 'draft-all', 'teste');
  answers.push('a');
  await ok('message', 'review', 'teste');
  out.length = 0;
  await ok('send', 'teste', '--dry-run');
  assert.match(out.join('\n'), /seria enviada/);
  await ok('send', 'teste');
  assert.match(out.join('\n'), /enviada\s+acme\.dev/);
  await ok('reply', 'add', 'jane@acme.dev', '--category', 'interested_to_talk', '--summary', 'Lets talk');
  out.length = 0;
  await ok('report');
  assert.match(out.join('\n'), /Taxa de resposta\s+100%\s+\(1\/1\)/);
  out.length = 0;
  await ok('company', 'show', 'acme.dev');
  assert.match(out.join('\n'), /qualified -> contacted[\s\S]*message_sent[\s\S]*reply_recorded/);
});

test('envio real exige digitar ENVIAR', async () => {
  const { run, out, answers, deps } = harness();
  const { outreachSetup } = await import('../testing/outreach.js');
  const context = outreachSetup();
  Object.assign(deps, context.deps);
  (context.email as { delivers: boolean }).delivers = true;
  const { draftMessage, approveMessage } = await import('../core/use-cases/messages.js');
  approveMessage(deps, draftMessage(deps, context.campaign, { companyRef: 'acme.dev' }).id);
  answers.push('sim');
  assert.equal(await run('send', context.campaign), 0);
  assert.match(out.join('\n'), /Nada foi enviado/);
  assert.equal(context.email.sent.length, 0);
  answers.push('ENVIAR');
  assert.equal(await run('send', context.campaign), 0);
  assert.equal(context.email.sent.length, 1);
});
