import { z } from 'zod';

export const leadsConfigSchema = z.object({
  version: z.number().int().positive(),
  segment: z.string().min(1),
  // Who is worth contacting and who to discard. It goes straight into the AI's instructions.
  profile: z.string().min(1),
  discovery: z.object({
    // Places to search, one at a time. "area" narrows a city to a neighbourhood: one search returns at most 60 places,
    // so big cities are covered by several areas.
    targets: z.array(z.object({ city: z.string().min(1), state: z.string().length(2), area: z.string().min(1).optional() })),
    perSearchLimit: z.number().int().min(1).max(60),
    // Search for new places only while fewer candidates than this are waiting to be contacted.
    minCandidates: z.number().int().min(0),
    maxSearchesPerRun: z.number().int().min(1),
    // Do not repeat the same search for this long.
    cooldownDays: z.number().int().min(1),
    // Hard stop on Google requests per calendar month (one request returns up to 20 places).
    maxRequestsPerMonth: z.number().int().min(1),
  }),
});

export type LeadsConfig = z.infer<typeof leadsConfigSchema>;
