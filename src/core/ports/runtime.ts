import type { ScoringConfig } from '../rules/scoring-config.js';
import type { SendingConfig } from '../rules/sending-config.js';
import type { EmailSender } from './email.js';
import type { WhatsappConfig } from '../rules/whatsapp-config.js';
import type { LeadsConfig } from '../rules/leads-config.js';
import type { LeadQualifier } from './lead-qualification.js';
import type { PageFetcher } from './pages.js';
import type { PlaceSource } from './places.js';
import type { ProspectingPorts } from './prospecting.js';
import type { QualifyingPorts } from './qualification.js';
import type { Store } from './store.js';
import type { Unsubscribe } from './unsubscribe.js';
import type { WhatsappChannel } from './whatsapp.js';

export interface Clock {
  now(): Date;
}

// name is the full name used in e-mails; nickname is how the person introduces themselves in WhatsApp (falls back to name).
export type SenderIdentity = { name: string; nickname: string; email: string; postalAddress: string };

export type Deps = {
  store: Store;
  clock: Clock;
  newId: () => string;
  scoring: ScoringConfig;
  sending: SendingConfig;
  sender: SenderIdentity;
  email: EmailSender;
  whatsapp: WhatsappConfig;
  leadsConfig: LeadsConfig;
  // Absent until AWS_BEARER_TOKEN_BEDROCK is set. Without it no lead is judged, so none is contacted.
  leadQualifier?: LeadQualifier;
  whatsappChannel: WhatsappChannel;
  // In [0, 1). Injected so the random wait between sends is testable.
  random: () => number;
  sleep: (ms: number) => Promise<void>;
  // Absent until HUNTER_API_KEY is set; prospecting commands say so instead of failing obscurely.
  prospecting?: ProspectingPorts;
  qualifying?: QualifyingPorts;
  // Absent until GOOGLE_PLACES_API_KEY is set; the `lead` commands say so instead of failing obscurely.
  places?: PlaceSource;
  pages?: PageFetcher;
  // Absent until the unsubscribe service is configured; e-mails then keep the reply-to-opt-out footer.
  unsubscribe?: Unsubscribe;
};
