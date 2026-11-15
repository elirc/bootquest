import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { PackCourseFile } from '@bootquest/shared';
import { readModules } from '../sysdrills/source.ts';
import { AGENTDRILLS_EXPECTED, DEFAULT_AUTHORING_DIR, DEFAULT_OUT_DIR, ImportError, importAgentdrills, stableKey } from './import.ts';
import { PRECISION_MIN, RECALL_MIN, readFixtures, type AgentdrillsFixture } from './source.ts';

const REPO = resolve(import.meta.dirname, '..', '..', '..', '..');
const tmp = mkdtempSync(join(tmpdir(), 'bq-agentdrills-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const fresh = (): string => join(tmp, `run-${n++}`);

/** a writable copy of the committed authoring, for the refusal cases */
function authoringCopy(): string {
  const dir = fresh();
  cpSync(DEFAULT_AUTHORING_DIR, dir, { recursive: true });
  return dir;
}
const fixturePath = (dir: string, drill: string): string => join(dir, 'fixtures', `${drill}.json`);
const editFixture = (dir: string, drill: string, fn: (f: AgentdrillsFixture) => void): void => {
  const p = fixturePath(dir, drill);
  const f = JSON.parse(readFileSync(p, 'utf8')) as AgentdrillsFixture;
  fn(f);
  writeFileSync(p, JSON.stringify(f));
};
const FIRST = '01-eval-graders/01-refusal-correctness';

/** precision / recall of one module source over a fixture, in process (independent of the drill runner) */
async function score(code: string, fx: AgentdrillsFixture): Promise<{ precision: number; recall: number }> {
  const f = join(tmp, `mod-${n++}.mjs`);
  writeFileSync(f, code);
  const mod: unknown = await import(pathToFileURL(f).href);
  const flag = new Function('mod', 'c', `return ${fx.flag};`) as (m: unknown, c: unknown) => unknown;
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const c of fx.cases) {
    let v = false;
    try {
      v = flag(mod, c) === true;
    } catch {
      v = false;
    }
    if (v && c.label) tp++;
    else if (v) fp++;
    else if (c.label) fn++;
  }
  return { precision: tp + fp === 0 ? 0 : tp / (tp + fp), recall: tp + fn === 0 ? 0 : tp / (tp + fn) };
}

describe('seed:import:agentdrills (rv3 S4 W8)', () => {
  it('imports the committed authoring to the committed pack bytes (deterministic), census 8', () => {
    const out = fresh();
    const r = importAgentdrills({ authoringDir: DEFAULT_AUTHORING_DIR, outDir: out, expected: AGENTDRILLS_EXPECTED });
    expect(r.manifest.totals).toEqual(AGENTDRILLS_EXPECTED);
    expect(r.manifest).toMatchObject({ source: 'agentdrills', track: 'agentic', grader: 'js' });
    for (const c of r.manifest.courses) expect(readFileSync(join(out, c.file), 'utf8')).toBe(readFileSync(join(DEFAULT_OUT_DIR, c.file), 'utf8'));
    const committed = JSON.parse(readFileSync(join(DEFAULT_OUT_DIR, 'manifest.json'), 'utf8')) as { courses: unknown };
    expect(r.manifest.courses).toEqual(committed.courses);
  });

  it('every unit is an agentic drill keyed agentdrills/<module>/<slug>, competency agentic-engineering, ending with the hand-label test', () => {
    const fixtures = readFixtures(DEFAULT_AUTHORING_DIR);
    for (const f of readdirSync(DEFAULT_OUT_DIR).filter((x) => /^\d\d-.*\.json$/.test(x))) {
      const file = PackCourseFile.parse(JSON.parse(readFileSync(join(DEFAULT_OUT_DIR, f), 'utf8')));
      for (const u of file.units) {
        const slug = u.unit.key.split('/')[2]!;
        expect(u.unit.key).toBe(stableKey(file.course.id, slug));
        expect(u.unit).toMatchObject({ track: 'agentic', kind: 'drill', competencies: ['agentic-engineering'] });
        const spec = u.unit.checks[0]!.spec as { type: string; tests: { name: string; code: string }[] };
        expect(spec.type).toBe('drill-js');
        const last = spec.tests.at(-1)!;
        const fx = fixtures.get(`${file.course.id}/${slug}`)!;
        expect(last.name).toBe(`precision and recall >= ${PRECISION_MIN} against the ${fx.cases.length} hand-labelled recorded cases`);
        expect(last.code).toContain(JSON.stringify(fx.cases));
      }
    }
  });

  it(`each reference grader clears precision ${PRECISION_MIN} and recall ${RECALL_MIN} against its hand labels, and each starter does not`, async () => {
    const fixtures = readFixtures(DEFAULT_AUTHORING_DIR);
    expect(fixtures.size).toBe(AGENTDRILLS_EXPECTED.total);
    for (const m of readModules(DEFAULT_AUTHORING_DIR)) {
      for (const ex of m.exercises) {
        const fx = fixtures.get(`${m.module}/${ex.slug}`)!;
        const ref = await score(ex.solution, fx);
        expect(ref.precision, `${fx.drill} reference precision`).toBeGreaterThanOrEqual(PRECISION_MIN);
        expect(ref.recall, `${fx.drill} reference recall`).toBeGreaterThanOrEqual(RECALL_MIN);
        const starter = await score(ex.starter, fx);
        expect(starter.precision >= PRECISION_MIN && starter.recall >= RECALL_MIN, `${fx.drill} starter must not pass`).toBe(false);
        // the trivial graders fail too: flag everything (precision = positive share <= 0.7), flag nothing (recall 0)
        const pos = fx.cases.filter((c) => c.label).length / fx.cases.length;
        expect(pos, `${fx.drill} positive share`).toBeLessThanOrEqual(0.7);
      }
    }
  });

  it('every fixture is built over the pinned harbor checkout, and every citation resolves there', () => {
    const fixtures = readFixtures(DEFAULT_AUTHORING_DIR);
    for (const fx of fixtures.values()) {
      expect(fx.source).toMatchObject({ repo: 'harbor', sha: '383b296196d5912fa9ed57893bea1de8ba5f394b' });
      const co = join(REPO, '.cache', 'checkouts', `${fx.source.repo}@${fx.source.sha}`);
      if (!existsSync(co)) continue; // the pinned mirror is local-only; the content gates run where it exists
      for (const cite of fx.source.cites) {
        const [, path, a, b] = /^([^:]+):(\d+)(?:-(\d+))?$/.exec(cite)!;
        const file = join(co, path!);
        expect(existsSync(file), `${fx.drill}: ${cite}`).toBe(true);
        const lines = readFileSync(file, 'utf8').split('\n').length;
        expect(Number(b ?? a), `${fx.drill}: ${cite} is past the end (${lines} lines)`).toBeLessThanOrEqual(lines);
        expect(Number(a)).toBeLessThanOrEqual(Number(b ?? a));
      }
    }
  });

  it('refuses, writing nothing: an exercise with no fixture, a fixture with no exercise, a census mismatch', () => {
    const noFixture = authoringCopy();
    rmSync(fixturePath(noFixture, FIRST));
    const out1 = fresh();
    expect(() => importAgentdrills({ authoringDir: noFixture, outDir: out1, expected: AGENTDRILLS_EXPECTED })).toThrow(/no fixture/);
    expect(existsSync(out1)).toBe(false);

    const orphan = authoringCopy();
    const f = JSON.parse(readFileSync(fixturePath(orphan, FIRST), 'utf8')) as AgentdrillsFixture;
    writeFileSync(join(orphan, 'fixtures', '01-eval-graders', '09-ghost.json'), JSON.stringify({ ...f, drill: '01-eval-graders/09-ghost' }));
    expect(() => importAgentdrills({ authoringDir: orphan, outDir: fresh(), expected: AGENTDRILLS_EXPECTED })).toThrow(/fixture 01-eval-graders\/09-ghost has no exercise/);

    expect(() => importAgentdrills({ authoringDir: DEFAULT_AUTHORING_DIR, outDir: fresh(), expected: { ...AGENTDRILLS_EXPECTED, total: 9, code: 9 } })).toThrow(/differ from the expected/);
  });

  it('refuses fixtures that cannot measure a grader: too few cases, mostly positives, one-sided labels, duplicate ids, a flag that ignores the module', () => {
    const cases: [string, (f: AgentdrillsFixture) => void, RegExp][] = [
      ['too few', (f) => void (f.cases = f.cases.slice(0, 9)), /need at least 10/],
      ['mostly positive', (f) => void (f.cases = f.cases.map((c, i) => ({ ...c, label: i < 13 }))), /a grader that flags everything would pass/],
      ['one-sided', (f) => void (f.cases = f.cases.map((c, i) => ({ ...c, label: i < 2 }))), /need at least 3 of each/],
      ['duplicate id', (f) => void (f.cases[1] = { ...f.cases[1]!, id: f.cases[0]!.id }), /duplicate case id/],
      ['no mod', (f) => void (f.flag = 'c.label'), /never asks the learner module/],
      ['wrong drill', (f) => void (f.drill = '01-eval-graders/02-grounded-citations'), /must be 01-eval-graders\/01-refusal-correctness/],
    ];
    for (const [what, edit, re] of cases) {
      const dir = authoringCopy();
      editFixture(dir, FIRST, edit);
      expect(() => importAgentdrills({ authoringDir: dir, outDir: fresh(), expected: AGENTDRILLS_EXPECTED }), what).toThrow(ImportError);
      expect(() => importAgentdrills({ authoringDir: dir, outDir: fresh(), expected: AGENTDRILLS_EXPECTED }), what).toThrow(re);
    }
  });
});
