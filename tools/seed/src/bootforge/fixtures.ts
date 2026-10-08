// Test fixtures in BootForge's compiled-course format (opusboot2 content/build/*.json).
// Shared by the importer and validator tests; not used at runtime.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const SQL_TEST_CODE = [
  "const { DatabaseSync } = await import('node:sqlite');",
  "const db = new DatabaseSync(':memory:');",
  "db.exec('PRAGMA foreign_keys = ON;');",
  "db.exec(\"CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO users (name) VALUES ('ada'), ('bob');\");",
  'const rows = db.prepare(mod.query).all().map((r) => ({ ...r }));',
  "assert.deepStrictEqual(rows, [{ name: 'ada' }, { name: 'bob' }]);",
].join('\n');

export function codeEx(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    type: 'code',
    title: 'add',
    prompt: 'Export a function `add(a, b)` returning the sum.',
    difficulty: 2,
    xp: 20,
    language: 'js',
    starter: 'export function add(a, b) {\n  // your code here\n}\n',
    solution: 'export function add(a, b) {\n  return a + b;\n}',
    tests: [
      { name: 'add(2, 3) → 5', input: [2, 3], code: 'assert.equal(mod.add(2, 3), 5);' },
      { name: 'add(-1, 1) → 0', input: [-1, 1], code: 'assert.equal(mod.add(-1, 1), 0);' },
    ],
    hints: ['Use +.'],
    explanation: 'Addition is the + operator.',
    skills: ['c1/m1'],
    ...over,
  };
}

export function sqlEx(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return codeEx(id, {
    title: 'select names',
    prompt: 'Export `query`: select every user name ordered by id.',
    starter: "export const query = '';\n",
    solution: "export const query = 'SELECT name FROM users ORDER BY id';",
    tests: [{ name: 'names in id order', code: SQL_TEST_CODE }],
    ...over,
  });
}

export function quizEx(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    type: 'quiz',
    title: 'Quick check',
    prompt: 'What does `typeof null` return?',
    difficulty: 1,
    xp: 5,
    options: ['"null"', '"object"', '"undefined"'],
    answerIndex: 1,
    hints: [],
    explanation: 'A historical quirk.',
    skills: ['c1/m1'],
    ...over,
  };
}

export function outputEx(id: string, code: string, expected: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    type: 'output',
    title: 'Predict the output',
    prompt: 'Read the code below and predict exactly what it prints.',
    difficulty: 1,
    xp: 10,
    code,
    expected,
    hints: [],
    explanation: 'Because.',
    skills: ['c1/m1'],
    ...over,
  };
}

export function writtenEx(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    type: 'written',
    title: 'Review a patch',
    prompt: 'Review the patch and write findings.',
    difficulty: 3,
    xp: 35,
    format: 'pr-review',
    starter: '## Findings\n',
    rubric: [
      { id: 'names-the-race', label: 'Names the race' },
      { id: 'cites-evidence', label: 'Cites evidence' },
    ],
    solution: 'The check-then-act race ...',
    hints: [],
    explanation: 'Model answer explained.',
    skills: ['c1/m1'],
    ...over,
  };
}

export function bfCourse(id: string, order: number, exercises: Record<string, unknown>[]): Record<string, unknown> {
  return {
    id,
    order,
    title: `Course ${id}`,
    description: 'Fixture course.',
    modules: [
      {
        id: 'm1',
        title: 'Module 1',
        lessons: [{ id: 'l1', title: 'Lesson 1', explanation: 'A lesson explanation that is long enough to read.', exercises }],
      },
    ],
  };
}

/** Write BootForge-format course files into dir (one per course, `<id>.json`). */
export function writeBfSource(dir: string, courses: Record<string, unknown>[]): void {
  mkdirSync(dir, { recursive: true });
  for (const c of courses) writeFileSync(join(dir, `${String(c.id)}.json`), JSON.stringify(c, null, 1));
}
