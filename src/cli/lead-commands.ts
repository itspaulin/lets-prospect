import { parseArgs } from 'node:util';
import { DomainError } from '../core/errors.js';
import type { Deps } from '../core/ports/runtime.js';
import { discoverLeads, discoverNextLeads, enrichLeads, listLeads, qualifyLeads } from '../core/use-cases/leads.js';
import type { Io } from './outreach-commands.js';

const int = (raw: string | undefined, flag: string): number | undefined => {
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) throw new DomainError('validation', `--${flag} deve ser inteiro`);
  return parsed;
};

export const leadCommand = async (deps: Deps, sub: string | undefined, args: string[], io: Io): Promise<void> => {
  const s = { type: 'string' } as const;
  switch (sub) {
    case 'discover': {
      const { values } = parseArgs({ args, options: { city: s, state: s, area: s, segment: s, limit: s, 'dry-run': { type: 'boolean' } }, strict: true });
      const report = await discoverLeads(deps, { city: values.city ?? '', state: values.state, area: values.area, segment: values.segment, limit: int(values.limit, 'limit'), dryRun: values['dry-run'] });
      io.out(`${values['dry-run'] ? 'Importaria' : 'Importados'}: ${report.imported.length}`);
      report.imported.forEach((item) => io.out(`  + ${item.name}  ${item.phone}${item.kind === 'landline' ? '  (fixo)' : ''}`));
      io.out(`Já cadastrados: ${report.alreadyKnown.length}. Sem telefone: ${report.noPhone.length}. Telefone inválido ou fora do padrão: ${report.invalidPhone.length}.`);
      report.invalidPhone.forEach((item) => io.out(`  ! ${item}`));
      return;
    }
    case 'auto': {
      const report = await discoverNextLeads(deps);
      report.searches.forEach((item) => io.out(`  + ${item.query}: ${item.imported} novos`));
      io.out(report.skipped ? `Busca automática: ${report.skipped}.` : `Busca automática: ${report.searches.length} pesquisa(s).`);
      return;
    }
    case 'qualify': {
      const { values } = parseArgs({ args, options: { limit: s }, strict: true });
      const report = await qualifyLeads(deps, { limit: int(values.limit, 'limit') });
      const count = (outcome: string) => report.results.filter((item) => item.outcome === outcome).length;
      io.out(`IA: bons ${count('fit')}, descartados ${count('not_a_fit')}, em dúvida ${count('unclear')}, site não lido ${count('unreachable')}.`);
      for (const item of report.results) io.out(`  ${item.outcome.padEnd(11)} ${item.name}: ${item.reason}`);
      return;
    }
    case 'enrich': {
      const { values } = parseArgs({ args, options: { limit: s, retry: { type: 'boolean' } }, strict: true });
      const report = await enrichLeads(deps, { limit: int(values.limit, 'limit'), retry: values.retry });
      io.out(`WhatsApp achado no site: ${report.found.length}. Celular do Google (sem confirmação): ${report.fromListing.length}. Sem WhatsApp: ${report.notFound.length}.`);
      report.found.forEach((item) => io.out(`  + ${item.name}  ${item.whatsapp}  (${item.source})`));
      report.fromListing.forEach((item) => io.out(`  ~ ${item.name}  ${item.whatsapp}`));
      report.notFound.forEach((item) => io.out(`  - ${item.name}: ${item.reason}`));
      return;
    }
    case 'list': {
      const { values } = parseArgs({ args, options: { status: s, city: s }, strict: true });
      const leads = listLeads(deps, { statuses: values.status?.split(',').map((item) => item.trim()).filter(Boolean), city: values.city });
      if (leads.length === 0) io.out('Nenhum lead.');
      for (const lead of leads) io.out(`${lead.status.padEnd(14)} ${lead.name}  ${lead.phone}${lead.phoneKind === 'landline' ? ' (fixo)' : ''}  whatsapp: ${lead.whatsapp ?? (lead.enrichedAt ? 'não achado' : 'não verificado')}  IA: ${lead.qualification?.verdict ?? '-'}${lead.city ? `  ${lead.city}` : ''}`);
      return;
    }
    default:
      throw new DomainError('validation', `Subcomando desconhecido: lead ${sub ?? ''}`);
  }
};
