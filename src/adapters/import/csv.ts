import { parse } from 'csv-parse/sync';
import { readFileSync } from 'node:fs';
import type { ImportRow } from '../../core/use-cases/imports.js';

export const parseCsvText = (text: string): ImportRow[] =>
  parse(text, {
    columns: (header: string[]) => header.map((column) => column.trim().toLowerCase()),
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as ImportRow[];

export const readCsv = (path: string): ImportRow[] => parseCsvText(readFileSync(path, 'utf8'));
