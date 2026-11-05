const MIN_QUOTE_LENGTH = 15;

const squash = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

// True only when the quote really is in the page. Short quotes prove nothing, so they never count.
export const quoteAppearsIn = (quote: string, text: string): boolean => {
  const needle = squash(quote);
  return needle.length >= MIN_QUOTE_LENGTH && squash(text).includes(needle);
};

// Menus, headings and keyword lists are Title Case runs of a few words. A real sentence has several
// lowercase function words ("we", "for", "and"), so this separates "Website Hosting & Support" from
// "We provide ongoing support for every site we build".
export const readsAsSentence = (quote: string): boolean => {
  const words = quote.trim().split(/\s+/);
  return words.length >= 6 && words.filter((word) => /^[a-zà-ÿ][a-zà-ÿ',]*$/.test(word)).length >= 3;
};

export const mentionsWord = (word: string, text: string): boolean => {
  const escaped = word.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped.length > 0 && new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i').test(text);
};
