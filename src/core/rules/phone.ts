import type { PhoneKind } from '../entities/lead.js';

export type BrazilPhone = { e164: string; kind: PhoneKind };

// Brazilian numbers only. Mobile numbers have 9 digits starting with 9 after the 2-digit area code; landlines
// have 8 digits starting with 2 to 5. Old 8-digit mobiles (starting 6 to 9, from before the extra 9) still show up on
// company sites, so they get the 9 added. Anything else (0800, short codes, foreign numbers) is not a lead we can message.
export const normalizeBrazilPhone = (raw: string): BrazilPhone | undefined => {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('0055')) digits = digits.slice(2);
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) digits = digits.slice(2);
  // The trunk prefix of "0 31 99999-8888" is dropped only when a full number follows it; "(01) ..." is not a valid area code.
  if (digits.startsWith('0') && (digits.length === 12 || digits.length === 13)) digits = digits.slice(1);
  if (digits.length !== 10 && digits.length !== 11) return undefined;
  const area = Number(digits.slice(0, 2));
  if (area < 11 || area > 99 || digits[1] === '0') return undefined;
  const subscriber = digits.slice(2);
  if (subscriber.length === 9 && subscriber.startsWith('9')) return { e164: `+55${digits}`, kind: 'mobile' };
  if (subscriber.length === 8 && /^[2-5]/.test(subscriber)) return { e164: `+55${digits}`, kind: 'landline' };
  if (subscriber.length === 8 && /^[6-9]/.test(subscriber)) return { e164: `+55${digits.slice(0, 2)}9${subscriber}`, kind: 'mobile' };
  return undefined;
};
