import { activateCampaign, addTarget, approveTemplate, createCampaign, setTemplate } from '../core/use-cases/campaigns.js';
import { addCompany, changeCompanyStatus } from '../core/use-cases/companies.js';
import { addContact } from '../core/use-cases/contacts.js';
import { addEvidence } from '../core/use-cases/evidences.js';
import { acme, createTestDeps } from './deps.js';

export const FIRST_TEMPLATE = {
  subject: 'Extra {{stack}} capacity for {{company.name}}',
  body: `Hi {{contact.firstName}},

{{reason}}

I'm a full-stack developer (Node.js, TypeScript, React) working with agencies that need extra hands on client projects.
Would a short call make sense?`,
};

export const FOLLOW_UP_TEMPLATE = { subject: 'Re: extra capacity for {{company.name}}', body: 'Hi {{contact.firstName}}, just following up on my note below.' };

export const qualifiedCompany = (deps: ReturnType<typeof createTestDeps>['deps'], overrides: Partial<typeof acme> = {}, email = 'jane@acme.dev') => {
  const { company } = addCompany(deps, { ...acme, ...overrides });
  const evidence = addEvidence(deps, company.domain, { kind: 'business_model', claim: 'case studies for clients', certainty: 'verified', source: `https://${company.domain}/work` });
  const contact = addContact(deps, company.domain, { name: 'Jane Doe', role: 'CTO', email, source: `https://${company.domain}/team` });
  changeCompanyStatus(deps, company.domain, 'qualified');
  return { company, contact, evidence };
};

export const outreachSetup = (options: { followUpTemplate?: boolean } = {}) => {
  const context = createTestDeps();
  const { deps } = context;
  const target = qualifiedCompany(deps);
  createCampaign(deps, { name: 'uk-agencies-nov', market: 'GB' });
  setTemplate(deps, 'uk-agencies-nov', { step: 0, ...FIRST_TEMPLATE });
  approveTemplate(deps, 'uk-agencies-nov', 0);
  if (options.followUpTemplate !== false) {
    setTemplate(deps, 'uk-agencies-nov', { step: 1, ...FOLLOW_UP_TEMPLATE });
    approveTemplate(deps, 'uk-agencies-nov', 1);
  }
  activateCampaign(deps, 'uk-agencies-nov');
  addTarget(deps, 'uk-agencies-nov', 'acme.dev');
  return { ...context, ...target, campaign: 'uk-agencies-nov' };
};
