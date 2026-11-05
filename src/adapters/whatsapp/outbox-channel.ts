import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WhatsappChannel, WhatsappOutgoing, WhatsappSendResult } from '../../core/ports/whatsapp.js';

// Default channel: writes each message as a text file instead of sending it. Nothing leaves the machine.
export class OutboxWhatsappChannel implements WhatsappChannel {
  readonly name = 'outbox (simulado)';
  readonly delivers = false;

  constructor(private readonly directory: string) {}

  async send(message: WhatsappOutgoing): Promise<WhatsappSendResult> {
    mkdirSync(this.directory, { recursive: true });
    const file = join(this.directory, `${message.messageId}.txt`);
    writeFileSync(file, `To: ${message.to}\n\n${message.body}\n`);
    return { status: 'sent', providerMessageId: file };
  }
}
