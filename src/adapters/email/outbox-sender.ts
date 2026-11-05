import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { htmlBody, type Signature } from './html-body.js';
import type { EmailSender, OutgoingEmail, SendResult } from '../../core/ports/email.js';

// Default transport: writes each message as an .eml file instead of sending it. Nothing leaves the machine.
export class OutboxEmailSender implements EmailSender {
  readonly name = 'outbox (simulado)';
  readonly delivers = false;

  constructor(
    private readonly directory: string,
    private readonly signature?: Signature,
  ) {}

  async send(email: OutgoingEmail): Promise<SendResult> {
    mkdirSync(this.directory, { recursive: true });
    const file = join(this.directory, `${email.headerMessageId.replace(/[<>@]/g, '_')}.eml`);
    const headers = [
      `From: ${email.from.name} <${email.from.email}>`,
      `To: ${email.to}`,
      `Subject: ${email.subject}`,
      `Message-ID: ${email.headerMessageId}`,
      ...Object.entries(email.headers).map(([key, value]) => `${key}: ${value}`),
      'Content-Type: text/plain; charset=utf-8',
    ];
    writeFileSync(file, `${headers.join('\r\n')}\r\n\r\n${email.text}\r\n`);
    // How the e-mail looks with the signature image, to open in a browser.
    if (this.signature) writeFileSync(file.replace(/\.eml$/, '.html'), htmlBody(email.text, this.signature, `data:image/png;base64,${this.signature.content.toString('base64')}`));
    return { status: 'sent', providerMessageId: file };
  }
}
