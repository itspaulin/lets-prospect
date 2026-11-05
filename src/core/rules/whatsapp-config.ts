import { z } from 'zod';

export const whatsappConfigSchema = z
  .object({
    version: z.number().int().positive(),
    // New conversations per day. Start low and raise it only while the number stays healthy.
    dailyLimit: z.number().int().positive(),
    // Wait between two sends: a random number of seconds between the two, so the rhythm does not look like a script.
    minIntervalSeconds: z.number().nonnegative(),
    maxIntervalSeconds: z.number().nonnegative(),
    window: z.object({
      timezone: z.string().min(1),
      // 1 = Monday ... 7 = Sunday
      days: z.array(z.number().int().min(1).max(7)).min(1),
      startHour: z.number().int().min(0).max(23),
      endHour: z.number().int().min(1).max(24),
    }),
    // The run stops after this many failed or unconfirmed sends in a row.
    stopAfterFailures: z.number().int().positive(),
    // The first message is one fixed text, so approving that text once (in firstMessage) is the review. With this on,
    // drafts are born approved and no one has to approve messages one by one.
    autoApprove: z.boolean().default(false),
    // Placeholders: {{lead.name}}, {{lead.shortName}}, {{sender.name}}, {{sender.nickname}}
    firstMessage: z.string().min(1),
  })
  .refine((config) => config.maxIntervalSeconds >= config.minIntervalSeconds, { message: 'maxIntervalSeconds não pode ser menor que minIntervalSeconds' })
  .refine((config) => config.window.endHour > config.window.startHour, { message: 'window.endHour precisa ser maior que window.startHour' });

export type WhatsappConfig = z.infer<typeof whatsappConfigSchema>;
