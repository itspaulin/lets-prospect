import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Signature } from '../adapters/email/html-body.js';
import { OutboxEmailSender } from '../adapters/email/outbox-sender.js';
import { SmtpEmailSender } from '../adapters/email/smtp-sender.js';
import { GooglePlacesClient } from '../adapters/prospecting/google-places.js';
import { HunterClient } from '../adapters/prospecting/hunter.js';
import { BedrockLeadQualifier } from '../adapters/prospecting/bedrock-lead-qualifier.js';
import { BedrockQualifier } from '../adapters/prospecting/bedrock-qualifier.js';
import { HttpSiteFetcher } from '../adapters/prospecting/site-fetcher.js';
import { WorkerUnsubscribe } from '../adapters/unsubscribe/worker-unsubscribe.js';
import { OutboxWhatsappChannel } from '../adapters/whatsapp/outbox-channel.js';
import { createSqliteStore, openDatabase } from '../adapters/persistence/sqlite-store.js';
import type { Deps } from '../core/ports/runtime.js';
import { loadEnv } from './env.js';
import { loadLeadsConfig, loadScoringConfig, loadSendingConfig, loadWhatsappConfig } from './scoring.js';

export const createContainer = (): Deps & { close: () => void } => {
  const env = loadEnv();
  const db = openDatabase(env.DATABASE_PATH);
  const sending = loadSendingConfig(env.SENDING_CONFIG_PATH);
  const signature: Signature | undefined = sending.signature && { content: readFileSync(sending.signature.image), filename: basename(sending.signature.image), alt: sending.signature.alt };
  const email =
    env.EMAIL_TRANSPORT === 'smtp'
      ? new SmtpEmailSender({ host: env.SMTP_HOST!, port: env.SMTP_PORT, secure: env.SMTP_SECURE, user: env.SMTP_USER!, password: env.SMTP_PASSWORD!, timeoutMs: env.SMTP_TIMEOUT_MS }, signature)
      : new OutboxEmailSender(env.OUTBOX_DIR, signature);
  // One fetcher for both uses, so robots.txt is read once per site.
  const siteFetcher = new HttpSiteFetcher();
  const hunter = env.HUNTER_API_KEY ? new HunterClient({ apiKey: env.HUNTER_API_KEY }) : undefined;
  return {
    store: createSqliteStore(db),
    clock: { now: () => new Date() },
    newId: randomUUID,
    scoring: loadScoringConfig(env.SCORING_CONFIG_PATH),
    sending,
    sender: { name: env.SENDER_NAME ?? '', nickname: env.SENDER_NICKNAME ?? env.SENDER_NAME ?? '', email: env.SENDER_EMAIL ?? '', postalAddress: env.SENDER_POSTAL_ADDRESS ?? '' },
    email,
    whatsapp: loadWhatsappConfig(env.WHATSAPP_CONFIG_PATH),
    leadsConfig: loadLeadsConfig(env.LEADS_CONFIG_PATH),
    leadQualifier: env.AWS_BEARER_TOKEN_BEDROCK ? new BedrockLeadQualifier({ token: env.AWS_BEARER_TOKEN_BEDROCK, region: env.AWS_REGION, modelId: env.BEDROCK_MODEL_ID }) : undefined,
    whatsappChannel: new OutboxWhatsappChannel(env.WHATSAPP_OUTBOX_DIR),
    random: Math.random,
    sleep: (ms) => sleep(ms).then(() => undefined),
    prospecting: hunter && { leads: hunter, finder: hunter },
    pages: siteFetcher,
    unsubscribe:
      env.UNSUBSCRIBE_BASE_URL && env.UNSUBSCRIBE_SECRET && env.UNSUBSCRIBE_API_TOKEN
        ? new WorkerUnsubscribe({ baseUrl: env.UNSUBSCRIBE_BASE_URL, secret: env.UNSUBSCRIBE_SECRET, apiToken: env.UNSUBSCRIBE_API_TOKEN })
        : undefined,
    places: env.GOOGLE_PLACES_API_KEY ? new GooglePlacesClient({ apiKey: env.GOOGLE_PLACES_API_KEY }) : undefined,
    qualifying: env.AWS_BEARER_TOKEN_BEDROCK
      ? { fetcher: siteFetcher, qualifier: new BedrockQualifier({ token: env.AWS_BEARER_TOKEN_BEDROCK, region: env.AWS_REGION, modelId: env.BEDROCK_MODEL_ID }) }
      : undefined,
    close: () => db.close(),
  };
};
