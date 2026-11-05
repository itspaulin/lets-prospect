import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { SMTPServer } from 'smtp-server';
import { classifySmtpError, SmtpEmailSender } from './smtp-sender.js';

const email = {
  from: { name: 'Maria', email: 'maria@example.dev' },
  to: 'jane@acme.test',
  subject: 'Hello',
  text: 'Body',
  headerMessageId: '<abc@example.dev>',
  headers: { 'List-Unsubscribe': '<mailto:maria@example.dev?subject=unsubscribe>' },
};

const startServer = (onRcpt: (address: string) => Error | undefined) =>
  new Promise<{ server: SMTPServer; port: number; received: string[] }>((resolve) => {
    const received: string[] = [];
    const server = new SMTPServer({
      authOptional: true,
      disabledCommands: ['STARTTLS'],
      onAuth: (_auth, _session, callback) => callback(null, { user: 'test' }),
      onRcptTo: (address, _session, callback) => callback(onRcpt(address.address) ?? undefined),
      onData: (stream, _session, callback) => {
        let data = '';
        stream.on('data', (chunk) => (data += chunk));
        stream.on('end', () => {
          received.push(data);
          callback();
        });
      },
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.server.address() as AddressInfo).port, received }));
  });

const sender = (port: number) => new SmtpEmailSender({ host: '127.0.0.1', port, secure: false, user: 'u', password: 'p', timeoutMs: 5000 });

test('SMTP local: envio aceito devolve o Message-ID e preserva cabeçalhos', async () => {
  const { server, port, received } = await startServer(() => undefined);
  try {
    const result = await sender(port).send(email);
    assert.equal(result.status, 'sent');
    assert.match(received[0]!, /Message-ID: <abc@example\.dev>/i);
    assert.match(received[0]!, /List-Unsubscribe: <mailto:maria@example\.dev\?subject=unsubscribe>/);
  } finally {
    server.close();
  }
});

test('SMTP local: com assinatura, vai texto e HTML com a imagem embutida (cid)', async () => {
  const { server, port, received } = await startServer(() => undefined);
  try {
    const signature = { content: Buffer.from('fake-png'), filename: 'assinatura.png', alt: 'Maria Souza' };
    const result = await new SmtpEmailSender({ host: '127.0.0.1', port, secure: false, user: 'u', password: 'p', timeoutMs: 5000 }, signature).send({ ...email, text: 'Olá <Jane>\n\nAbraço' });
    assert.equal(result.status, 'sent');
    assert.match(received[0]!, /Content-Type: text\/plain/);
    assert.match(received[0]!, /Content-Type: text\/html/);
    assert.match(received[0]!, /src=3D"cid:assinatura"/);
    assert.match(received[0]!, /Content-ID: <assinatura>/);
    assert.match(received[0]!, /Ol=C3=A1 &lt;Jane&gt;/);
  } finally {
    server.close();
  }
});

test('SMTP local: destinatário recusado vira failed', async () => {
  const { server, port } = await startServer(() => Object.assign(new Error('mailbox unavailable'), { responseCode: 550 }));
  try {
    const result = await sender(port).send(email);
    assert.equal(result.status, 'failed');
  } finally {
    server.close();
  }
});

test('servidor fora do ar vira failed; queda de conexão vira unknown', async () => {
  const result = await sender(1).send(email);
  assert.equal(result.status, 'failed');
  assert.equal(classifySmtpError(Object.assign(new Error('Connection closed'), { code: 'ESOCKET' })).status, 'unknown');
  assert.equal(classifySmtpError(Object.assign(new Error('Timeout'), { code: 'ETIMEDOUT' })).status, 'unknown');
  assert.equal(classifySmtpError(Object.assign(new Error('Invalid login'), { code: 'EAUTH', responseCode: 535 })).status, 'failed');
});
