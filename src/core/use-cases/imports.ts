import { DomainError } from '../errors.js';
import type { Deps } from '../ports/runtime.js';
import { addCompany } from './companies.js';
import { addContact } from './contacts.js';

export type ImportRow = Record<string, string | undefined>;
export type ImportReport = {
  created: { line: number; label: string }[];
  skipped: { line: number; label: string; reason: string }[];
  failed: { line: number; label: string; error: string }[];
};

const value = (row: ImportRow, key: string): string | undefined => {
  const raw = row[key]?.trim();
  return raw ? raw : undefined;
};

const list = (raw: string | undefined): string[] => (raw ? raw.split(/[;|]/).map((item) => item.trim()).filter(Boolean) : []);

const integer = (raw: string | undefined, field: string): number | undefined => {
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) throw new DomainError('validation', `${field} deve ser inteiro: "${raw}"`);
  return parsed;
};

// Each row is its own transaction: a bad line is reported and the rest still imports. Re-running the
// same file skips what already exists, so imports are safe to repeat.
const run = (rows: ImportRow[], labelOf: (row: ImportRow) => string, importRow: (row: ImportRow) => void): ImportReport => {
  const report: ImportReport = { created: [], skipped: [], failed: [] };
  rows.forEach((row, index) => {
    const line = index + 2;
    const label = labelOf(row);
    try {
      importRow(row);
      report.created.push({ line, label });
    } catch (error) {
      if (error instanceof DomainError && error.code === 'duplicate') report.skipped.push({ line, label, reason: error.message });
      else if (error instanceof DomainError) report.failed.push({ line, label, error: error.message });
      else throw error;
    }
  });
  return report;
};

class PreviewRollback extends Error {}

// Runs the import inside a transaction that is always rolled back, so the report shows exactly what a
// real import would create, skip or reject without writing anything.
const preview = (deps: Deps, work: () => ImportReport): ImportReport => {
  let report: ImportReport | undefined;
  try {
    deps.store.transaction(() => {
      report = work();
      throw new PreviewRollback();
    });
  } catch (error) {
    if (!(error instanceof PreviewRollback)) throw error;
  }
  return report!;
};

export type ImportOptions = { dryRun?: boolean };

export const importCompanies = (deps: Deps, rows: ImportRow[], options: ImportOptions = {}): ImportReport =>
  options.dryRun ? preview(deps, () => importCompanies(deps, rows)) : run(
    rows,
    (row) => value(row, 'website') ?? value(row, 'name') ?? '(vazio)',
    (row) =>
      addCompany(deps, {
        name: value(row, 'name') ?? '',
        website: value(row, 'website') ?? '',
        country: value(row, 'country') ?? '',
        region: value(row, 'region'),
        segment: value(row, 'segment'),
        employeeCount: integer(value(row, 'employees'), 'employees'),
        services: value(row, 'services'),
        technologies: list(value(row, 'technologies')),
        source: value(row, 'source'),
        lastVerifiedAt: value(row, 'last_verified_at'),
        notes: value(row, 'notes'),
      }),
  );

export const importContacts = (deps: Deps, rows: ImportRow[], options: ImportOptions = {}): ImportReport =>
  options.dryRun ? preview(deps, () => importContacts(deps, rows)) : run(
    rows,
    (row) => `${value(row, 'name') ?? '(sem nome)'} @ ${value(row, 'company') ?? '?'}`,
    (row) => {
      const company = value(row, 'company');
      if (!company) throw new DomainError('validation', 'coluna company (domínio da empresa) é obrigatória');
      addContact(deps, company, {
        name: value(row, 'name') ?? '',
        role: value(row, 'role'),
        email: value(row, 'email'),
        source: value(row, 'source'),
        profileUrl: value(row, 'profile_url'),
        notes: value(row, 'notes'),
      });
    },
  );
