import { parseArgs } from 'node:util';
import { DomainError } from '../core/errors.js';
import type { Deps } from '../core/ports/runtime.js';
import { pendingQualification, qualifyCompany } from '../core/use-cases/ai-qualification.js';
import { creditsRemaining, discoverCompanies, findContacts, runProspecting, type DiscoverReport, type FindContactsReport } from '../core/use-cases/prospecting.js';
import type { Io } from './outreach-commands.js';

const list = (raw: string | undefined) => raw?.split(',').map((item) => item.trim()).filter(Boolean);
const int = (raw: string | undefined, flag: string): number | undefined => {
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) throw new DomainError('validation', `--${flag} deve ser inteiro`);
  return parsed;
};

const printDiscover = (report: DiscoverReport, dryRun: boolean | undefined, io: Io): void => {
  io.out(`${dryRun ? 'Importaria' : 'Importadas'}: ${report.imported.length}`);
  report.imported.forEach((item) => io.out(`  + ${item.domain}  ${item.name}`));
  io.out(`Já cadastradas: ${report.alreadyKnown.length}. Suprimidas: ${report.suppressed.length}. Sem e-mail pessoal no Hunter: ${report.noContacts.length}. Com erro: ${report.failed.length}.`);
  report.failed.forEach((item) => io.out(`  ! ${item.domain}: ${item.error}`));
};

const printContacts = (report: FindContactsReport, io: Io): void => {
  for (const company of report.companies) {
    io.out(`${company.domain}${company.note ? ` (${company.note})` : ''}`);
    company.added.forEach((line) => io.out(`  + ${line}`));
    company.skipped.forEach((line) => io.out(`  - ${line}`));
  }
  io.out(`Créditos gastos: ${report.spentCredits}${report.stoppedByCap ? ' (parou no teto; rode de novo para continuar)' : ''}`);
};

const searchOptions = { country: { type: 'string' }, state: { type: 'string' }, city: { type: 'string' }, headcount: { type: 'string' }, keywords: { type: 'string' }, limit: { type: 'string' } } as const;

export const prospectCommand = async (deps: Deps, sub: string | undefined, args: string[], io: Io): Promise<void> => {
  const s = { type: 'string' } as const;
  switch (sub) {
    case 'discover': {
      const { values } = parseArgs({ args, options: { ...searchOptions, 'dry-run': { type: 'boolean' } }, strict: true });
      printDiscover(
        await discoverCompanies(deps, { country: values.country ?? '', state: values.state, city: values.city, headcount: list(values.headcount), keywords: list(values.keywords), limit: int(values.limit, 'limit'), dryRun: values['dry-run'] }),
        values['dry-run'],
        io,
      );
      return;
    }
    case 'qualify': {
      const { values, positionals } = parseArgs({ args, options: { pending: { type: 'boolean' }, limit: { type: 'string' } }, allowPositionals: true, strict: true });
      const domains = values.pending ? pendingQualification(deps, int(values.limit, 'limit')).map((company) => company.domain) : positionals;
      if (domains.length === 0) throw new DomainError('validation', values.pending ? 'Nenhuma empresa identified pendente de qualificação' : 'Informe ao menos um domínio ou --pending');
      const counts: Record<string, number> = {};
      for (const domain of domains) {
        try {
          const result = await qualifyCompany(deps, domain);
          counts[result.outcome] = (counts[result.outcome] ?? 0) + 1;
          io.out(`${result.domain}: ${result.outcome} (${result.reason})`);
        } catch (error) {
          if (!(error instanceof DomainError)) throw error;
          counts.error = (counts.error ?? 0) + 1;
          io.out(`${domain}: erro (${error.message})`);
        }
      }
      io.out(`Resumo: ${Object.entries(counts).map(([outcome, count]) => `${outcome} ${count}`).join(', ')}`);
      return;
    }
    case 'run': {
      const { values } = parseArgs({ args, options: { ...searchOptions, 'max-credits': { type: 'string' }, 'per-company': { type: 'string' } }, strict: true });
      const report = await runProspecting(deps, {
        country: values.country ?? '',
        state: values.state,
        city: values.city,
        headcount: list(values.headcount),
        keywords: list(values.keywords),
        limit: int(values.limit, 'limit'),
        maxCredits: int(values['max-credits'], 'max-credits'),
        perCompany: int(values['per-company'], 'per-company'),
      });
      if (report.discovered) printDiscover(report.discovered, false, io);
      io.out('Qualificação:');
      report.qualified.forEach((item) => io.out(`  ${item.domain}: ${item.outcome} (${item.reason})`));
      if (report.contacts) printContacts(report.contacts, io);
      else io.out('Nenhuma empresa qualificada: nenhum crédito gasto.');
      return;
    }
    case 'contacts': {
      const { values, positionals } = parseArgs({ args, options: { 'max-credits': s, 'per-company': s }, allowPositionals: true, strict: true });
      if (positionals.length === 0) throw new DomainError('validation', 'Informe ao menos um domínio');
      const report = await findContacts(deps, positionals, { maxCredits: int(values['max-credits'], 'max-credits'), perCompany: int(values['per-company'], 'per-company') });
      printContacts(report, io);
      return;
    }
    case 'credits':
      io.out(`Créditos restantes no Hunter: ${await creditsRemaining(deps)}`);
      return;
    default:
      throw new DomainError('validation', `Subcomando desconhecido: prospect ${sub ?? ''}`);
  }
};
