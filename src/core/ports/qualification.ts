export type SitePage = { url: string; text: string };

// No pages means "could not read it", never "has nothing"; problem says why, for the person reviewing.
export type SiteRead = { pages: SitePage[]; problem?: string };

export interface SiteFetcher {
  fetchSite(domain: string): Promise<SiteRead>;
}

export type FindingKind = 'business_model' | 'recurring_work' | 'demand_signal' | 'technology';

// Every finding carries a quote copied from the page. The core checks it against the page text, so a
// claim the model made up never becomes a verified fact.
export type QualifierFinding = {
  kind: FindingKind;
  stance: 'supports' | 'contradicts';
  claim: string;
  quote: string;
  pageUrl: string;
};

// Both kinds are targets: a company that builds software for its own clients, and an IT consultancy or outsourcing firm that
// delivers development work or allocates developers to its clients' projects.
export type TargetSegment = 'software_house' | 'it_consultancy';

export type QualifierVerdict = {
  verdict: 'software_house' | 'not_a_fit' | 'unclear';
  // Which kind of target it is. Only meaningful when the verdict is software_house.
  segment?: TargetSegment;
  reason: string;
  findings: QualifierFinding[];
  technologies: string[];
};

export type QualifierInput = {
  company: { name: string; domain: string; country: string };
  pages: SitePage[];
};

export interface Qualifier {
  readonly name: string;
  qualify(input: QualifierInput): Promise<QualifierVerdict>;
}

export type QualifyingPorts = { fetcher: SiteFetcher; qualifier: Qualifier };
