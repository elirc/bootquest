// seed:audit:explanations (rv3 PLAN §2): a failing and a passing fixture per rule, a fixture tree through
// runAudit (summary + gate count), and one read of the committed authoring (shape only: the rewrite moves it).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../factory/report.ts';
import {
  AUDIT_TRACKS,
  auditDrill,
  auditGateFailures,
  auditLesson,
  auditQuiz,
  contentWords,
  drillTestNames,
  formatAuditItems,
  formatAuditSummary,
  jsBlocks,
  lessonSections,
  proseWords,
  runAudit,
  type QuizInput,
} from './explain-audit.ts';

const words = (n: number, w = 'value'): string => Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ');

// a quiz item whose explanation meets every gate rule
const base: QuizInput = {
  id: 'fund:js/01-demo/q01',
  prompt: 'What does `typeof null` give?',
  choices: ["'object'", "'null'", "'undefined'", 'It throws a TypeError'],
  answer: 0,
  explanation:
    "A historical bug from the first engine kept the null tag equal to the object tag, and the language never fixed it for compatibility. Reading 'null' back is the tempting guess; test for null with === null instead of relying on typeof.",
};
const other: QuizInput = { id: 'fund:js/01-demo/q02', prompt: 'Which default keeps 0?', choices: ['the nullish coalescing operator keeps zero', 'logical or'], answer: 0, explanation: 'x' };

describe('quiz rules Q1-Q5', () => {
  it('the passing fixture passes every rule', () => {
    const a = auditQuiz('js', '01-demo', base, [base, other]);
    expect(a.fails).toEqual([]);
    expect(a.words).toBeGreaterThanOrEqual(25);
    expect(a.distractorWords).toContain('null');
  });
  it('Q1: under 25 or over 90 words fails; 25 and 90 pass', () => {
    const at = (n: number) => auditQuiz('js', 't', { ...base, explanation: `Instead of guessing, ${words(n - 3)}.` }, [base]).fails.includes('Q1');
    expect(at(24)).toBe(true);
    expect(at(25)).toBe(false);
    expect(at(90)).toBe(false);
    expect(at(91)).toBe(true);
  });
  it('Q2: an explanation that only restates the prompt and the keyed choice fails', () => {
    const restating = { ...base, explanation: "typeof null gives 'object': typeof null gives object, so typeof null is object, the typeof of null gives object every time, typeof null object, null object typeof null instead." };
    const a = auditQuiz('js', 't', restating, [base]);
    expect(a.fails).toContain('Q2');
    expect(a.restate).toBeGreaterThan(0.7);
    expect(auditQuiz('js', 't', base, [base]).fails).not.toContain('Q2');
  });
  it('Q3: an explanation that names no distractor and no misconception fails; a distractor word or a misconception phrase passes', () => {
    const plain = { ...base, explanation: `The engine kept an early tag layout for compatibility, so the operator reports object here; ${words(20)}.` };
    expect(auditQuiz('js', 't', plain, [base]).fails).toContain('Q3');
    expect(auditQuiz('js', 't', { ...plain, explanation: `${plain.explanation} It never throws a TypeError.` }, [base]).fails).not.toContain('Q3');
    expect(auditQuiz('js', 't', { ...plain, explanation: `${plain.explanation} The common trap is to trust it.` }, [base]).fails).not.toContain('Q3');
  });
  it('Q4: a reference to a choice by position fails; "above 2^53" (a comparison) passes', () => {
    for (const p of ['option B is the trap', 'the first choice throws', 'as the answer above says', 'the last option is wrong'])
      expect(auditQuiz('js', 't', { ...base, explanation: `${base.explanation} ${p}.` }, [base]).fails, p).toContain('Q4');
    expect(auditQuiz('js', 't', { ...base, explanation: `${base.explanation} Ids above 2^53 also round.` }, [base]).fails).not.toContain('Q4');
  });
  it('Q5: restating the keyed answer of another item of the same gate fails', () => {
    const leaky = { ...base, explanation: `${base.explanation} For defaults, the nullish coalescing operator keeps zero.` };
    const a = auditQuiz('js', 't', leaky, [base, other]);
    expect(a.fails).toContain('Q5');
    expect(a.why.Q5).toContain('fund:js/01-demo/q02');
    // its own keyed answer is not a leak
    expect(auditQuiz('js', 't', { ...other, explanation: `${base.explanation} the nullish coalescing operator keeps zero` }, [base, other]).fails).not.toContain('Q5');
  });
});

const longExpl = (extra = ''): string =>
  `Copy the input before touching it, so the caller's object is left alone; ${words(40)}. Writing the default with || instead of ?? turns a real 0 into the default, and the test "retries 0 is kept, not replaced by 3" fails then.${extra}`;

describe('drill rules D1-D4', () => {
  const tests = ['retries 0 is kept, not replaced by 3', 'null falls back to the default'];
  const hints = ['Keep a value the caller set, even a falsy one.', 'Fall back only when the value is missing, and build a new object.', 'Use `??` per field: `{ retries: o.retries ?? 3 }`.'];
  it('the passing fixture passes D1 and D4 and is not listed under D2', () => {
    const a = auditDrill('js', 't', { id: 'd', explanation: longExpl(), hints, testNames: tests });
    expect(a.fails).toEqual([]);
    expect(a.listed).not.toContain('D2');
    expect(a.d2).toEqual({ namesTest: true, namesWrongApproach: true });
  });
  it('D1: under 60 prose words fails, and a fenced code block does not count', () => {
    const code = `\`\`\`js\n${words(80)}\n\`\`\``;
    const a = auditDrill('js', 't', { id: 'd', explanation: `Short prose instead of a reason.\n\n${code}`, hints, testNames: tests });
    expect(a.fails).toContain('D1');
    expect(a.words).toBe(6);
    expect(auditDrill('js', 't', { id: 'd', explanation: longExpl(), hints, testNames: tests }).fails).not.toContain('D1');
  });
  it('D2: listed when no test is named or no wrong approach is named', () => {
    const a = auditDrill('js', 't', { id: 'd', explanation: `Copy the input first and fill in defaults per field; ${words(60)}.`, hints, testNames: tests });
    expect(a.listed).toContain('D2');
    expect(a.d2).toEqual({ namesTest: false, namesWrongApproach: false });
    // most of a test name's words, with the word "test", counts as naming it
    expect(auditDrill('js', 't', { id: 'd', explanation: `The null fallback test checks the default, not the input; ${words(60)}.`, hints, testNames: tests }).d2.namesTest).toBe(true);
  });
  it('D3: claim sentences that name a test are the proof worklist', () => {
    const a = auditDrill('js', 't', { id: 'd', explanation: longExpl(' It throws on a cycle.'), hints, testNames: tests });
    expect(a.listed).toContain('D3');
    expect(a.claims).toEqual(['Writing the default with || instead of ?? turns a real 0 into the default, and the test "retries 0 is kept, not replaced by 3" fails then.']);
  });
  it('D4: hint 1 or hint 2 with code (`;`, `=>`, return, parentheses, arithmetic in backticks) fails; hint 3 may be code', () => {
    for (const [i, h] of [
      [0, 'Use a guard; then return.'],
      [1, 'Map with x => x + 1'],
      [1, 'Call merge(a, b) on both'],
      [1, 'Multiply `a * b` first'],
    ] as const) {
      const hs = [...hints];
      hs[i] = h;
      expect(auditDrill('js', 't', { id: 'd', explanation: longExpl(), hints: hs, testNames: tests }).fails, h).toContain('D4');
    }
    expect(auditDrill('js', 't', { id: 'd', explanation: longExpl(), hints: hints.slice(0, 2), testNames: tests }).why.D4).toBe('2 hints (want 3)');
    // java also refuses its lambda arrow
    expect(auditDrill('java', 't', { id: 'd', explanation: longExpl(), hints: [hints[0]!, 'Map each k -> v pair', hints[2]!], testNames: tests }).fails).toContain('D4');
    expect(auditDrill('js', 't', { id: 'd', explanation: longExpl(), hints: [hints[0]!, 'Map each k -> v pair', hints[2]!], testNames: tests }).fails).not.toContain('D4');
  });
  it('test names per track: js / sysdrills tests[].name, csharp Test("...") in tests, java test("...") in the solution', () => {
    expect(drillTestNames('js', { tests: [{ name: 'a' }, { name: 'b' }] })).toEqual(['a', 'b']);
    expect(drillTestNames('csharp', { tests: 'Test("one \\"q\\" two", () => Eq(1, 1));\nTest("three", () => {});' })).toEqual(['one \\"q\\" two', 'three']);
    expect(drillTestNames('java', { solution: 'test("x is 1", () -> eq(1, 1));' })).toEqual(['x is 1']);
  });
});

const section = (h: string, n: number, extra = ''): string => `## ${h}\n\n${words(n)} ${extra}\n`;

describe('lesson rules L1-L3', () => {
  const quiz: QuizInput[] = [
    { id: 'q1', prompt: 'p', choices: ['the nullish operator keeps zero', 'or'], answer: 0, explanation: 'e' },
    { id: 'q2', prompt: 'p', choices: ['frozen objects reject writes', 'b'], answer: 0, explanation: 'e' },
  ];
  const good = `Intro.\n\n${section('Defaults', 200, 'the nullish operator keeps zero `??` 0')}${section('Freezing', 200, 'frozen objects reject writes in strict mode, 1 case')}`;
  it('the passing fixture passes L1 and lists nothing', () => {
    const a = auditLesson('js', 't', good, quiz, { '1': 'Defaults', '2': 'Freezing' });
    expect(a.fails).toEqual([]);
    expect(a.listed).toEqual([]);
    expect(a.sections).toBe(2);
  });
  it('L1: under 380 prose words fails; a section under 40 words fails', () => {
    expect(auditLesson('js', 't', `${section('A', 150)}${section('B', 150)}`, quiz, undefined).why.L1).toMatch(/prose words \(min 380\)/);
    const a = auditLesson('js', 't', `${good}${section('Tiny', 10, '`x`')}`, quiz, { '1': 'Defaults', '2': 'Freezing' });
    expect(a.why.L1).toContain('"Tiny"');
  });
  it('L2: a gate item whose heading is unmapped, missing, or lacks the keyed words is listed', () => {
    const a = auditLesson('js', 't', good, quiz, { '1': 'Freezing', '2': 'Nope' });
    expect(a.l2).toEqual([
      { item: 'q1', heading: 'Freezing', share: 0 },
      { item: 'q2', heading: 'Nope', share: null },
    ]);
    expect(auditLesson('js', 't', good, quiz, undefined).l2.map((x) => x.heading)).toEqual([null, null]);
  });
  it('L3: a section with no code span, no code block and no number is listed', () => {
    const a = auditLesson('js', 't', `${good}## Prose only\n\n${'word '.repeat(50).replace(/\d/g, '')}\n`, quiz, { '1': 'Defaults', '2': 'Freezing' });
    expect(a.l3).toEqual(['Prose only']);
  });
  it('sections ignore ## inside a code fence and keep ### inside their section; js blocks are extracted for L4', () => {
    const md = '## One\n\n```js\n## not a heading\nconst a = 1;\n```\n\n### Sub\n\ntext\n\n## Two\n\nmore';
    expect(lessonSections(md).map((s) => s.heading)).toEqual(['One', 'Two']);
    expect(jsBlocks(md)).toEqual(['## not a heading\nconst a = 1;\n']);
    expect(proseWords(md)).toBe(5);
  });
});

describe('words', () => {
  it('content words drop stop words and 1-letter words, stem plurals and -ed / -ing, keep digits', () => {
    expect([...contentWords("The caller's values were returned, 2 times, by a cached lookup")].sort()).toEqual(['2', 'cach', 'caller', 'lookup', 'return', 'time', 'value'].sort());
  });
});

describe('runAudit over a fixture tree', () => {
  const root = mkdtempSync(join(tmpdir(), 'bq-explain-audit-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const put = (rel: string, v: unknown): void => {
    const f = join(root, rel);
    mkdirSync(resolve(f, '..'), { recursive: true });
    writeFileSync(f, JSON.stringify(v));
  };
  const topic = {
    topic: '01-demo',
    lesson: `${section('Defaults', 200, 'the nullish operator keeps zero `??`')}${section('Freezing', 200, '1')}`,
    quiz: [base, { ...base, explanation: 'Too short.' }],
    drills: [{ slug: 'd1', explanation: longExpl(), hints: ['a', 'b', 'c'], tests: [{ name: 'retries 0 is kept, not replaced by 3' }] }],
  };
  put('fund/js/01-demo.json', topic);
  put('sys/01-estimation.json', { module: '01-estimation', exercises: [{ slug: 'x', explanation: 'short', hints: ['a;', 'b', 'c'], tests: [{ name: 't' }] }] });
  put('sections.json', { js: { '01-demo': { gate: { '1': 'Defaults', '2': 'Defaults' } } } });
  const a = runAudit({ fundamentalsAuthoring: join(root, 'fund'), sysdrillsAuthoring: join(root, 'sys'), sectionsFile: join(root, 'sections.json') }, ['js', 'sysdrills']);
  it('scores every item, keys them like the importer and counts the gate failures', () => {
    expect(a.quiz.map((q) => q.id)).toEqual(['fund:js/01-demo/q01', 'fund:js/01-demo/q02']);
    expect(a.quiz[1]!.fails).toEqual(['Q1', 'Q3']);
    expect(a.drills.map((d) => [d.id, d.fails])).toEqual([
      ['fund-js/01-demo/d1', []],
      ['sysdrills/01-estimation/x', ['D1', 'D4']],
    ]);
    expect(auditGateFailures(a)).toBe(2);
    expect(a.summary.find((s) => s.track === 'js')!.quiz).toEqual({ items: 2, pass: 1, fail: { Q1: 1, Q3: 1 } });
  });
  it('prints a summary table and the failing items', () => {
    const t = formatAuditSummary(a).join('\n');
    expect(t).toContain('| js | quiz | 1/2 (50%) | Q1 1, Q3 1 | - |');
    expect(t).toContain('| sysdrills | drills | 0/1 (0%) | D1 1, D4 1 |');
    expect(formatAuditItems(a)).toHaveLength(2);
    expect(formatAuditItems(a, { rule: 'D4' })).toEqual([expect.stringMatching(/^FAIL sysdrills\/01-estimation\/x: D1 1 prose words \(min 60\) \| D4 hint 1 contains ";"$/)]);
  });
});

describe('the committed authoring', () => {
  it('audits every track: 3 Fundamentals tracks and the sysdrills bank, every item scored', () => {
    const a = runAudit({
      fundamentalsAuthoring: join(REPO_ROOT, 'tools', 'seed', 'authoring', 'fundamentals'),
      sysdrillsAuthoring: join(REPO_ROOT, 'tools', 'seed', 'authoring', 'sysdrills'),
      sectionsFile: join(REPO_ROOT, 'content', 'fundamentals', 'sections.json'),
    });
    expect(a.summary.map((s) => s.track)).toEqual([...AUDIT_TRACKS]);
    for (const s of a.summary.filter((x) => x.track !== 'sysdrills')) {
      expect(s.quiz.items).toBeGreaterThanOrEqual(200);
      expect(s.lessons.items).toBeGreaterThanOrEqual(20);
    }
    expect(a.summary.find((s) => s.track === 'sysdrills')!.drills.items).toBeGreaterThanOrEqual(129);
  });
});
