// Order of relevance: CEO/founder, then CTO, then other C-levels, then heads and VPs, then directors.
// Hunter's "senior" bucket includes senior developers and analysts. Outreach should reach whoever can
// buy capacity, so roles are ranked here and anything below the cut is dropped.
const NON_TECH_AREA = /\b(marketing|sales|hr|human resources|people|finance|financial|recruit\w*|talent|legal|account manager)\b/i;

export const decisionMakerScore = (role: string | undefined): number => {
  if (!role) return 0;
  const text = role.toLowerCase();
  if (/\b(founder|co-founder|cofounder|owner|ceo|chief executive|managing director|managing partner|president)\b/.test(text)) return 100;
  if (NON_TECH_AREA.test(text)) return 0;
  if (/\b(cto|chief technology|chief technical)\b/.test(text)) return 90;
  if (/\b(chief|coo|cpo)\b/.test(text)) return 80;
  if (/\b(head of|vp|vice president)\b/.test(text)) return 70;
  if (/\b(director|partner|principal)\b/.test(text)) return 60;
  return 0;
};

export const isDecisionMaker = (role: string | undefined): boolean => decisionMakerScore(role) >= 60;
