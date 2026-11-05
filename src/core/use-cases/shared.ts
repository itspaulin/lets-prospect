import { z } from 'zod';
import type { Company } from '../entities/company.js';
import type { Interaction } from '../entities/interaction.js';
import { DomainError } from '../errors.js';
import type { Deps } from '../ports/runtime.js';
import { normalizeDomain } from '../rules/normalize.js';

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'use o formato AAAA-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'data inválida');

export const parseInput = <T extends z.ZodType>(schema: T, input: unknown): z.infer<T> => {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const message = result.error.issues.map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message)).join('; ');
  throw new DomainError('validation', message);
};

export const nowIso = (deps: Deps): string => deps.clock.now().toISOString();
export const today = (deps: Deps): string => nowIso(deps).slice(0, 10);

export const record = (deps: Deps, interaction: Omit<Interaction, 'id' | 'occurredAt'>): void => {
  deps.store.interactions.insert({ ...interaction, id: deps.newId(), occurredAt: nowIso(deps) });
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const resolveCompany = (deps: Deps, ref: string): Company => {
  const company = UUID.test(ref) ? deps.store.companies.findById(ref) : deps.store.companies.findByDomain(normalizeDomain(ref));
  if (!company) throw new DomainError('not_found', `Empresa não encontrada: ${ref}`);
  return company;
};

export type Patch<T> = { [K in keyof T]?: T[K] | null };

export const applyPatch = <T extends object>(current: T, patch: Patch<T>): { next: T; changes: Record<string, { from: unknown; to: unknown }> } => {
  const next = { ...current } as Record<string, unknown>;
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const to = value === null ? undefined : value;
    const from = next[key];
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    next[key] = to;
    changes[key] = { from, to };
  }
  return { next: next as T, changes };
};
