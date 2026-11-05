export type DiscoverQuery = {
  country: string;
  state?: string;
  city?: string;
  headcount?: string[];
  keywords: string[];
  limit: number;
};

// personalEmails is how many named-person addresses the provider knows; undefined when it did not say.
export type DiscoveredCompany = { domain: string; name: string; personalEmails?: number };

// Free: finding companies costs nothing, so callers can run it as often as they like.
export interface LeadSource {
  readonly name: string;
  discover(query: DiscoverQuery): Promise<DiscoveredCompany[]>;
}

export type FoundContact = {
  email: string;
  name: string;
  role?: string;
  confidence?: number;
  verification: 'valid' | 'invalid' | 'unknown';
  sources: string[];
};

// Paid: every search that returns a result spends credits, so callers must check the balance first.
export interface EmailFinder {
  readonly name: string;
  creditsRemaining(): Promise<number>;
  findDecisionMakers(domain: string, options: { limit: number }): Promise<FoundContact[]>;
}

export type ProspectingPorts = { leads: LeadSource; finder: EmailFinder };
