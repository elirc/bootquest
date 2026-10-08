import { z } from 'zod';

/**
 * Zod schemas for BootForge's compiled course JSON (opusboot2
 * `content/build/<course>.json`, working tree — LEARNING.md R1), mirroring
 * opusboot2 shared/types.ts. Objects are STRICT: an upstream field this
 * importer does not know is an import error (format drift is surfaced, never
 * silently dropped). Discriminated by exercise `type`.
 */

const Base = {
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*){3}$/, 'course/module/lesson/slug'),
  title: z.string().min(1),
  prompt: z.string().min(1),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  xp: z.number().int().positive(),
  hints: z.array(z.string()),
  explanation: z.string().min(1),
  skills: z.array(z.string().regex(/^[a-z0-9]+(?:[/-][a-z0-9]+)*$/)).optional(),
  format: z.enum(['debugging', 'test-writing', 'pr-review', 'schema-migration', 'incident', 'project']).optional(),
  reviewOf: z.string().min(1).optional(),
};

export const BfTest = z
  .object({
    name: z.string().min(1),
    /** AsyncFunction('mod','assert') body (the runner uses AsyncFunction, not Function) */
    code: z.string().min(1),
    input: z.unknown().optional(),
  })
  .strict();

export const BfCode = z
  .object({
    ...Base,
    type: z.literal('code'),
    language: z.enum(['js', 'ts']),
    starter: z.string(),
    solution: z.string().min(1),
    tests: z.array(BfTest).min(1),
  })
  .strict();

export const BfQuiz = z
  .object({
    ...Base,
    type: z.literal('quiz'),
    options: z.array(z.string().min(1)).min(2),
    answerIndex: z.number().int().nonnegative(),
  })
  .strict()
  .refine((q) => q.answerIndex < q.options.length, { message: 'answerIndex out of range', path: ['answerIndex'] })
  .refine((q) => new Set(q.options).size === q.options.length, { message: 'options must be unique (single-keyed)', path: ['options'] });

export const BfOutput = z
  .object({
    ...Base,
    type: z.literal('output'),
    code: z.string().min(1),
    expected: z.string().min(1),
  })
  .strict();

export const BfWritten = z
  .object({
    ...Base,
    type: z.literal('written'),
    starter: z.string().optional(),
    rubric: z.array(z.object({ id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), label: z.string().min(1) }).strict()).min(1),
    solution: z.string().min(1),
  })
  .strict();

export const BfExercise = z.union([BfCode, BfQuiz, BfOutput, BfWritten]);
export type BfExercise = z.infer<typeof BfExercise>;
export type BfCode = z.infer<typeof BfCode>;
export type BfQuiz = z.infer<typeof BfQuiz>;
export type BfOutput = z.infer<typeof BfOutput>;
export type BfWritten = z.infer<typeof BfWritten>;

/** Exercises are parsed one by one with parseExercise (precise errors), so the skeleton keeps them raw. */
export const BfLesson = z
  .object({ id: z.string().min(1), title: z.string().min(1), explanation: z.string(), exercises: z.array(z.unknown()).min(1) })
  .strict();
export const BfModule = z.object({ id: z.string().min(1), title: z.string().min(1), lessons: z.array(BfLesson).min(1) }).strict();
export const BfCourse = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    order: z.number().int().positive(),
    title: z.string().min(1),
    description: z.string(),
    modules: z.array(BfModule).min(1),
  })
  .strict();
export type BfCourse = z.infer<typeof BfCourse>;

/**
 * Parse one exercise with a type-specific schema so errors name the real
 * problem (a plain union reports every branch's mismatch).
 */
export function parseExercise(raw: unknown): BfExercise {
  const t = (raw as { type?: unknown } | null)?.type;
  switch (t) {
    case 'code':
      return BfCode.parse(raw);
    case 'quiz':
      return BfQuiz.parse(raw);
    case 'output':
      return BfOutput.parse(raw);
    case 'written':
      return BfWritten.parse(raw);
    default:
      throw new Error(`unknown BootForge exercise type ${JSON.stringify(t)}`);
  }
}
