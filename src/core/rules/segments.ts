// The two kinds of target company. The AI writes one of these on the company when it qualifies it, and a campaign whose
// segment is exactly one of them only receives that kind, so each kind gets its own e-mail texts.
export const TARGET_SEGMENTS = ['software house', 'consultoria de TI'] as const;
export type TargetSegmentLabel = (typeof TARGET_SEGMENTS)[number];

// A campaign's segment is also a free-text description ("agências Node/React"); only the exact labels filter.
export const campaignTargetSegment = (segment: string | undefined): TargetSegmentLabel | undefined =>
  TARGET_SEGMENTS.find((label) => label.toLowerCase() === segment?.trim().toLowerCase());
