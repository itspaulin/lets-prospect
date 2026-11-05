import { z } from 'zod';

export const sendingConfigSchema = z
  .object({
    version: z.number().int().positive(),
    dailyLimit: z.number().int().positive(),
    minIntervalSeconds: z.number().nonnegative(),
    followUp: z.object({
      maxFollowUps: z.number().int().min(0).max(3),
      intervalBusinessDays: z.array(z.number().int().positive()),
    }),
    footer: z.string().min(1),
    // Used instead of `footer` when the descadastro link is configured; may use {{unsubscribeUrl}}.
    footerWithLink: z.string().min(1).optional(),
    // Image appended after the footer of every e-mail; `image` is a path relative to where the app runs.
    signature: z.object({ image: z.string().min(1), alt: z.string().min(1) }).optional(),
  })
  .refine((config) => config.followUp.intervalBusinessDays.length >= config.followUp.maxFollowUps, {
    message: 'followUp.intervalBusinessDays precisa de um intervalo para cada follow-up',
  })
  .refine((config) => config.followUp.intervalBusinessDays.every((days, index, all) => index === 0 || days > all[index - 1]!), {
    message: 'followUp.intervalBusinessDays são dias úteis depois do primeiro e-mail e precisam crescer (ex.: 3, 5, 7)',
  });

export type SendingConfig = z.infer<typeof sendingConfigSchema>;
