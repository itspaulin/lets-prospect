import assert from 'node:assert/strict';
import test from 'node:test';
import { keepWanted, normalizeStack } from './technology.js';

const WANTED = ['Node.js', 'TypeScript', 'JavaScript', 'PostgreSQL', 'Go', 'Next.js', 'React', 'C#', 'AWS', 'Vue.js'];

test('mantém só o que está na lista, com a grafia da lista', () => {
  assert.deepEqual(keepWanted(['NodeJS', 'php', 'Postgres', 'Golang', 'next.js', 'React.js', 'WordPress', 'csharp', 'Amazon Web Services', 'Vue'], WANTED), [
    'Node.js',
    'PostgreSQL',
    'Go',
    'Next.js',
    'React',
    'C#',
    'AWS',
    'Vue.js',
  ]);
});

test('sinônimos não duplicam', () => {
  assert.deepEqual(keepWanted(['Node', 'Node.js', 'node js'], WANTED), ['Node.js']);
});

test('stack completa: sinônimos viram uma entrada e o que não é meu continua', () => {
  assert.deepEqual(normalizeStack(['nodejs', 'PHP', 'Node', 'Laravel', ' php '], WANTED), ['Node.js', 'PHP', 'Laravel']);
});
