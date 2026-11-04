// fund wave: mock Fundamentals ladder (two JS topics; the second waits for the first's quiz gate).
// The topic units are study-quiz units (lesson = instructions); they join studyQuestFixtures so the
// mock's unit detail / submit flow serves them exactly like the borrowbox study quest.
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
