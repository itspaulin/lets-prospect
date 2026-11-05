// Sites and the model spell the same tool many ways ("Node", "NodeJS", "node.js"). Keys drop case, dots,
// spaces and dashes; aliases cover names that differ beyond that.
const key = (name: string): string => name.toLowerCase().replace(/[\s.\-_]/g, '');

const ALIASES: Record<string, string> = {
  node: 'nodejs',
  js: 'javascript',
  ecmascript: 'javascript',
  ts: 'typescript',
  nest: 'nestjs',
  postgres: 'postgresql',
  psql: 'postgresql',
  golang: 'go',
  next: 'nextjs',
  reactjs: 'react',
  vue: 'vuejs',
  angularjs: 'angular',
  nuxt: 'nuxtjs',
  express: 'expressjs',
  svelte: 'sveltejs',
  amazonwebservices: 'aws',
  csharp: 'c#',
  rabbit: 'rabbitmq',
};

export const canonicalKey = (name: string): string => ALIASES[key(name)] ?? key(name);

// Keeps only the technologies on the wanted list, spelled the way the list spells them.
export const keepWanted = (names: string[], wanted: string[]): string[] => {
  const byKey = new Map(wanted.map((name) => [canonicalKey(name), name]));
  return [...new Set(names.map((name) => byKey.get(canonicalKey(name))).filter((name): name is string => !!name))];
};

// The company's whole stack, one entry per tool: names on the wanted list take the list's spelling, the
// rest keep the site's. Keeping the others is what lets the score say "4 of 10 match".
export const normalizeStack = (names: string[], wanted: string[]): string[] => {
  const byKey = new Map(wanted.map((name) => [canonicalKey(name), name]));
  const seen = new Map<string, string>();
  for (const raw of names) {
    const name = raw.trim();
    const id = canonicalKey(name);
    if (name && !seen.has(id)) seen.set(id, byKey.get(id) ?? name);
  }
  return [...seen.values()];
};
