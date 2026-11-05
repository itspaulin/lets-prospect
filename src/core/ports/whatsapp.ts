export type WhatsappOutgoing = { to: string; body: string; messageId: string };

// "blocked" means the account itself was restricted or banned: the run stops, because every further send would make it worse.
export type WhatsappSendResult =
  | { status: 'sent'; providerMessageId?: string }
  | { status: 'failed'; error: string }
  | { status: 'unknown'; error: string }
  | { status: 'blocked'; error: string };

export interface WhatsappChannel {
  readonly name: string;
  // False for the simulated channel: nothing leaves the machine.
  readonly delivers: boolean;
  send(message: WhatsappOutgoing): Promise<WhatsappSendResult>;
}
