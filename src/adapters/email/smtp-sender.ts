import nodemailer, { type Transporter } from 'nodemailer';
import { htmlBody, SIGNATURE_CID, type Signature } from './html-body.js';
import type { EmailSender, OutgoingEmail, SendResult } from '../../core/ports/email.js';

export type SmtpSettings = { host: string; port: number; secure: boolean; user: string; password: string; timeoutMs: number };

type SmtpError = Error & { code?: string; responseCode?: number; command?: string };

// Only errors that prove the server did not accept the message count as "failed". Anything that
// can happen after the server took the data (timeouts, dropped sockets) is "unknown".
export const classifySmtpError = (error: SmtpError): SendResult => {
  const detail = [error.code, error.responseCode, error.message].filter(Boolean).join(' ');
  if (error.responseCode && error.responseCode >= 400) return { status: 'failed', error: detail };
  if (['EAUTH', 'EENVELOPE', 'EMESSAGE', 'EDNS', 'ECONFIG', 'ETLS'].includes(error.code ?? '')) return { status: 'failed', error: detail };
  if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH/.test(error.message)) return { status: 'failed', error: detail };
  return { status: 'unknown', error: detail };
};

export class SmtpEmailSender implements EmailSender {
  readonly name: string;
  readonly delivers = true;
  private readonly transport: Transporter;

  constructor(
    settings: SmtpSettings,
    private readonly signature?: Signature,
  ) {
    this.name = `smtp ${settings.host}:${settings.port}`;
    this.transport = nodemailer.createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      auth: { user: settings.user, pass: settings.password },
      connectionTimeout: settings.timeoutMs,
      greetingTimeout: settings.timeoutMs,
      socketTimeout: settings.timeoutMs,
    });
  }

  async send(email: OutgoingEmail): Promise<SendResult> {
    try {
      const info = await this.transport.sendMail({
        from: { name: email.from.name, address: email.from.email },
        to: email.to,
        subject: email.subject,
        text: email.text,
        ...(this.signature && {
          html: htmlBody(email.text, this.signature, `cid:${SIGNATURE_CID}`),
          attachments: [{ filename: this.signature.filename, content: this.signature.content, cid: SIGNATURE_CID, contentDisposition: 'inline' as const }],
        }),
        messageId: email.headerMessageId,
        headers: email.headers,
      });
      if (info.rejected?.length) return { status: 'failed', error: `destinatário recusado: ${info.response}` };
      return { status: 'sent', providerMessageId: info.messageId, response: info.response };
    } catch (error) {
      return classifySmtpError(error as SmtpError);
    }
  }
}
