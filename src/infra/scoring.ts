import { readFileSync } from 'node:fs';
import type { z } from 'zod';
import { scoringConfigSchema, type ScoringConfig } from '../core/rules/scoring-config.js';
import { sendingConfigSchema, type SendingConfig } from '../core/rules/sending-config.js';
import { leadsConfigSchema, type LeadsConfig } from '../core/rules/leads-config.js';
import { whatsappConfigSchema, type WhatsappConfig } from '../core/rules/whatsapp-config.js';

const loadJson = <T>(schema: z.ZodType<T>, path: string, label: string): T => {
  const result = schema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!result.success) throw new Error(`Configuração de ${label} inválida em ${path}: ${result.error.message}`);
  return result.data;
};

export const loadScoringConfig = (path: string): ScoringConfig => loadJson(scoringConfigSchema, path, 'qualificação');
export const loadSendingConfig = (path: string): SendingConfig => loadJson(sendingConfigSchema, path, 'envio');
export const loadWhatsappConfig = (path: string): WhatsappConfig => loadJson(whatsappConfigSchema, path, 'WhatsApp');
export const loadLeadsConfig = (path: string): LeadsConfig => loadJson(leadsConfigSchema, path, 'leads');
