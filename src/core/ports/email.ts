export type OutgoingEmail = {
  from: { name: string; email: string };
  to: string;
  subject: string;
  text: string;
  headerMessageId: string;
  headers: Record<string, string>;
};

// "unknown" means the provider may or may not have accepted the message (timeout, dropped connection).
// Callers must never retry it automatically.
export type SendResult =
  | { status: 'sent'; providerMessageId?: string; response?: string }
  | { status: 'failed'; error: string }
  | { status: 'unknown'; error: string };

export interface EmailSender {
  readonly name: string;
  readonly delivers: boolean;
  send(email: OutgoingEmail): Promise<SendResult>;
}
