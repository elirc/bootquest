// fund wave: mock Fundamentals ladder (two JS topics; the second waits for the first's quiz gate).
// The topic units are study-quiz units (lesson = instructions); they join studyQuestFixtures so the
// mock's unit detail / submit flow serves them exactly like the borrowbox study quest.
import type { LessonAids } from '../types';
import type { StudyQuestFixture } from './ladder';

const LESSON_1 = `## The seven primitives

JavaScript has seven primitive types: \`string\`, \`number\`, \`bigint\`, \`boolean\`, \`undefined\`, \`symbol\` and \`null\`. Everything else is an object.

## typeof surprises

\`\`\`js
typeof null  // 'object'
typeof []    // 'object'
\`\`\`

Test arrays with \`Array.isArray(value)\`.`;

const LESSON_2 = `## Closures

A function keeps access to the variables of the scope it was created in, even after that scope returned.`;

export const fundStudyFixtures: Record<string, StudyQuestFixture & { instructions: string }> = {
  '207': {
    unit: { id: 207, key: 'fund/js/01-values-types-and-coercion', trackId: 'js', kind: 'study', title: '01 · Values, types & coercion', difficulty: 1, state: 'available', revealed: false, prerequisites: [] },
    instructions: LESSON_1,
    public: {
      repo: 'fundamentals',
      sha: '',
      passPct: 80,
      readingSteps: [],
      questions: [
        { itemKey: 'fund:js/01-values-types-and-coercion/q01', prompt: 'What does `typeof null` evaluate to?', choices: ["'null'", "'object'", "'undefined'"] },
        { itemKey: 'fund:js/01-values-types-and-coercion/q02', prompt: 'Which value is truthy?', choices: ['0', "'0'", "''"] },
        { itemKey: 'fund:js/01-values-types-and-coercion/q03', prompt: 'How do you test for an array?', choices: ['Array.isArray(value)', "typeof value === 'array'", 'value instanceof Object'] },
        { itemKey: 'fund:js/01-values-types-and-coercion/q04', prompt: "What is `Number('')`?", choices: ['NaN', '0', 'undefined'] },
        { itemKey: 'fund:js/01-values-types-and-coercion/q05', prompt: 'What is `null == undefined`?', choices: ['true', 'false', 'It throws'] },
      ],
      flashcards: 3,
    },
    keys: [1, 1, 0, 1, 0],
  },
  '208': {
    unit: { id: 208, key: 'fund/js/02-functions-and-closures', trackId: 'js', kind: 'study', title: '02 · Functions & closures', difficulty: 1, state: 'locked', revealed: false, prerequisites: [207] },
    instructions: LESSON_2,
    public: {
      repo: 'fundamentals',
      sha: '',
      passPct: 80,
      readingSteps: [],
      questions: [
        { itemKey: 'fund:js/02-functions-and-closures/q01', prompt: 'What does a closure capture?', choices: ['A copy of each value', 'The variables of its creating scope', 'Nothing'] },
      ],
      flashcards: 2,
    },
    keys: [1],
  },
};

/** The ladder per track: topic metadata + the unit ids it is built from. */
export const fundLadderFixtures: Record<string, { id: string; order: number; title: string; level: 'beginner' | 'intermediate' | 'advanced'; summary: string; unitId: number; drillIds: number[] }[]> = {
  js: [
    {
      id: '01-values-types-and-coercion',
      order: 1,
      title: 'Values, types & coercion',
      level: 'beginner',
      summary: 'The seven primitives, what typeof reports, truthy and falsy, and how == and + coerce.',
      unitId: 207,
      drillIds: [],
    },
    {
      id: '02-functions-and-closures',
      order: 2,
      title: 'Functions & closures',
      level: 'beginner',
      summary: 'Declarations versus expressions, scope, and what a closure keeps alive.',
      unitId: 208,
      drillIds: [],
    },
  ],
};

/**
 * f52 U3: the authored explanation of each gate question (PRIVATE: served only through
 * GET /units/:id/notes after a verified pass of the topic's gate, with the keyed choice text).
 */
export const fundExplanationFixtures: Record<string, string> = {
  'fund:js/01-values-types-and-coercion/q01': '`typeof null` is `\'object\'`: a bug from the first JavaScript engine that can never be fixed without breaking the web.',
  'fund:js/01-values-types-and-coercion/q02': 'Every non-empty string is truthy, including `\'0\'`. Only the empty string is a falsy string.',
  'fund:js/01-values-types-and-coercion/q03': '`typeof []` is `\'object\'`, so only `Array.isArray` tells an array from any other object.',
  'fund:js/01-values-types-and-coercion/q04': 'The empty string converts to `0`, not `NaN`.',
  'fund:js/01-values-types-and-coercion/q05': '`null` and `undefined` are loosely equal to each other and to nothing else.',
  'fund:js/02-functions-and-closures/q01': 'A closure keeps the variables themselves alive, not a snapshot of their values.',
};

/**
 * f52 wave B: lesson aids of the mock topics (server: content/fundamentals/sections.json). `gate` maps
 * each 1-based question number to the lesson heading that teaches it; `checks` are ungraded reveal cards.
 */
export const fundLessonAidFixtures: Record<string, LessonAids> = {
  '207': {
    gate: { '1': 'typeof surprises', '2': 'The seven primitives', '3': 'typeof surprises', '4': 'The seven primitives', '5': 'The seven primitives' },
    checks: [
      { heading: 'The seven primitives', prompt: 'Is `42n` a primitive? Of which type?', answer: 'Yes: it is a `bigint`, one of the seven primitive types.' },
      { heading: 'typeof surprises', prompt: 'What does `typeof function () {}` report?', answer: "`'function'`, although a function is an object." },
    ],
  },
};
