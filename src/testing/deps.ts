import { fileURLToPath } from 'node:url';
import { createSqliteStore, openDatabase } from '../adapters/persistence/sqlite-store.js';
import type { EmailSender, OutgoingEmail, SendResult } from '../core/ports/email.js';
import type { Deps } from '../core/ports/runtime.js';
import type { WhatsappChannel, WhatsappOutgoing, WhatsappSendResult } from '../core/ports/whatsapp.js';
import { loadScoringConfig, loadSendingConfig } from '../infra/scoring.js';

export const SCORING_PATH = fileURLToPath(new URL('../../config/scoring.json', import.meta.url));
export const SENDING_PATH = fileURLToPath(new URL('../../config/sending.json', import.meta.url));

export class FakeEmailSender implements EmailSender {
  readonly name = 'fake';
  readonly delivers = false;
  readonly sent: OutgoingEmail[] = [];
  next: (email: OutgoingEmail) => SendResult | Promise<SendResult> = () => ({ status: 'sent', providerMessageId: `provider-${this.sent.length + 1}` });

  async send(email: OutgoingEmail): Promise<SendResult> {
    const result = await this.next(email);
    if (result.status === 'sent') this.sent.push(email);
    return result;
  }
}

export class FakeWhatsappChannel implements WhatsappChannel {
  readonly name = 'fake whatsapp';
  readonly delivers = false;
  readonly sent: WhatsappOutgoing[] = [];
  next: (message: WhatsappOutgoing) => WhatsappSendResult | Promise<WhatsappSendResult> = () => ({ status: 'sent', providerMessageId: `wamid-${this.sent.length + 1}` });

  async send(message: WhatsappOutgoing): Promise<WhatsappSendResult> {
    const result = await this.next(message);
    if (result.status === 'sent') this.sent.push(message);
    return result;
  }
}

export const createTestDeps = (start = '2026-10-26T12:00:00.000Z') => {
  const db = openDatabase(':memory:');
  let current = new Date(start);
  let sequence = 0;
  const email = new FakeEmailSender();
  const whatsappChannel = new FakeWhatsappChannel();
  const sleeps: number[] = [];
  const deps: Deps = {
    store: createSqliteStore(db),
    clock: { now: () => current },
    newId: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
    scoring: loadScoringConfig(SCORING_PATH),
    // Fixed here so the tests do not move when config/sending.json is edited; the multi-follow-up tests override it.
    sending: { ...loadSendingConfig(SENDING_PATH), followUp: { maxFollowUps: 1, intervalBusinessDays: [5, 7] } },
    sender: { name: 'Maria Souza', nickname: 'Maria', email: 'maria@example.dev', postalAddress: 'PO Box 1, São Paulo, Brazil' },
    email,
    // Monday 26 Oct 2026 12:00 UTC is 09:00 in São Paulo: inside the window on purpose.
    whatsapp: {
      version: 1,
      dailyLimit: 5,
      minIntervalSeconds: 120,
      maxIntervalSeconds: 300,
      window: { timezone: 'America/Sao_Paulo', days: [1, 2, 3, 4, 5], startHour: 9, endHour: 18 },
      stopAfterFailures: 3,
      autoApprove: false,
      firstMessage: 'Oi, aqui é o {{sender.name}}. Vi a {{lead.shortName}} e queria te mostrar uma ideia. Posso mandar?',
    },
    leadsConfig: {
      version: 1,
      segment: 'imobiliária',
      profile: 'Imobiliárias de venda ou aluguel. Descartar portais, construtoras e administradoras de condomínio.',
      discovery: {
        targets: [
          { city: 'Belo Horizonte', state: 'MG' },
          { city: 'Recife', state: 'PE', area: 'Boa Viagem' },
        ],
        perSearchLimit: 40,
        minCandidates: 10,
        maxSearchesPerRun: 1,
        cooldownDays: 30,
        maxRequestsPerMonth: 100,
      },
    },
    whatsappChannel,
    random: () => 0,
    sleep: async (ms) => void sleeps.push(ms),
  };
  return {
    deps,
    db,
    email,
    whatsappChannel,
    sleeps,
    advanceDays: (days: number) => {
      current = new Date(current.getTime() + days * 86_400_000);
    },
  };
};

export const acme = {
  name: 'Acme Software Ltd',
  website: 'https://www.acme.dev/about',
  country: 'UK',
  employeeCount: 20,
  technologies: ['React', 'Node.js', 'Ruby'],
  source: 'https://www.acme.dev/about',
};
