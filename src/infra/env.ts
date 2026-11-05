import { z } from 'zod';

const optional = z.string().trim().optional().transform((value) => value || undefined);

const schema = z
  .object({
    DATABASE_PATH: z.string().min(1).default('./data/prospeccao.db'),
    SCORING_CONFIG_PATH: z.string().min(1).default('./config/scoring.json'),
    SENDING_CONFIG_PATH: z.string().min(1).default('./config/sending.json'),
    LEADS_CONFIG_PATH: z.string().min(1).default('./config/leads.json'),
    WHATSAPP_CONFIG_PATH: z.string().min(1).default('./config/whatsapp.json'),
    WHATSAPP_OUTBOX_DIR: z.string().min(1).default('./data/whatsapp-outbox'),
    OUTBOX_DIR: z.string().min(1).default('./data/outbox'),
    EMAIL_TRANSPORT: z.enum(['outbox', 'smtp']).default('outbox'),
    SENDER_NAME: optional,
    SENDER_NICKNAME: optional,
    SENDER_EMAIL: optional,
    SENDER_POSTAL_ADDRESS: optional,
    SMTP_HOST: optional,
    SMTP_PORT: z.coerce.number().int().positive().default(465),
    SMTP_SECURE: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
    SMTP_USER: optional,
    SMTP_PASSWORD: optional,
    HUNTER_API_KEY: optional,
    GOOGLE_PLACES_API_KEY: optional,
    AWS_BEARER_TOKEN_BEDROCK: optional,
    AWS_REGION: z.string().trim().min(1).default('us-east-1'),
    BEDROCK_MODEL_ID: z.string().trim().min(1).default('us.anthropic.claude-haiku-4-5-20251001-v1:0'),
    // Cloudflare Worker that serves the opt-out link. All three or none.
    UNSUBSCRIBE_BASE_URL: optional,
    UNSUBSCRIBE_SECRET: optional,
    UNSUBSCRIBE_API_TOKEN: optional,
    SMTP_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  })
  .superRefine((env, ctx) => {
    const unsubscribe = [env.UNSUBSCRIBE_BASE_URL, env.UNSUBSCRIBE_SECRET, env.UNSUBSCRIBE_API_TOKEN];
    if (unsubscribe.some(Boolean) && !unsubscribe.every(Boolean))
      ctx.addIssue({ code: 'custom', path: ['UNSUBSCRIBE_BASE_URL'], message: 'defina UNSUBSCRIBE_BASE_URL, UNSUBSCRIBE_SECRET e UNSUBSCRIBE_API_TOKEN juntas, ou nenhuma' });
    if (env.EMAIL_TRANSPORT !== 'smtp') return;
    for (const key of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SENDER_NAME', 'SENDER_EMAIL', 'SENDER_POSTAL_ADDRESS'] as const)
      if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: `obrigatória com EMAIL_TRANSPORT=smtp` });
  });

export type Env = z.infer<typeof schema>;

export const loadEnv = (source: NodeJS.ProcessEnv = process.env): Env => {
  const result = schema.safeParse(source);
  if (!result.success) throw new Error(`Configuração inválida: ${result.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}`);
  return result.data;
};
