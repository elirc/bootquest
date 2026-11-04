import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PackCourseFile, PackManifest } from '@bootquest/shared';
import { FundamentalsFile, FundamentalsManifest, FUND_TRACKS } from '@bootquest/shared/fundamentals';
import { buildTrack, DEFAULT_AUTHORING_ROOT, DEFAULT_PACKS_ROOT, DEFAULT_TOPICS_ROOT, FUNDAMENTALS_EXPECTED, ImportError, importFundamentals } from './import.ts';

/**
 * seed:import:fundamentals: the committed authoring compiles to exactly the committed outputs
 * (deterministic, census-bound), and every refusal fires before anything is written.
 */

const real = (track: string, topic: string) => JSON.parse(readFileSync(join(DEFAULT_AUTHORING_ROOT, track, `${topic}.json`), 'utf8')) as Record<string, unknown> & {
  topic: string;
  lesson: string;
  quiz: { prompt: string; choices: string[]; answer: number; explanation: string }[];
  flashcards: { front: string; back: string }[];
  drills: Record<string, unknown>[];
};
const firstTopic = (track: string) => readdirSync(join(DEFAULT_AUTHORING_ROOT, track)).sort()[0]!.replace(/\.json$/, '');

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fund-import-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function authoring(track: string, files: Record<string, unknown>): string {
  const root = join(dir, 'authoring');
  mkdirSync(join(root, track), { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(root, track, `${name}.json`), JSON.stringify(body, null, 2));
  return root;
}
const run = (track: 'js' | 'csharp' | 'java', root: string) =>
  importFundamentals({ track, authoringRoot: root, topicsRoot: join(dir, 'topics'), packsRoot: join(dir, 'packs'), expected: null });

describe('the committed authoring', () => {
  for (const track of FUND_TRACKS) {
    it(`${track}: compiles to the committed bytes and matches the census`, () => {
      const r = importFundamentals({ track, authoringRoot: DEFAULT_AUTHORING_ROOT, topicsRoot: join(dir, 'topics'), packsRoot: join(dir, 'packs'), expected: FUNDAMENTALS_EXPECTED[track] });
      expect(r.counts).toEqual(FUNDAMENTALS_EXPECTED[track]);
      // byte-identical to what is committed (the importer is deterministic). The committed manifests
      // also record git HEAD / dirtiness, so they are compared by their content hashes instead.
      expect(readFileSync(join(dir, 'topics', track, 'topics.json'), 'utf8')).toBe(readFileSync(join(DEFAULT_TOPICS_ROOT, track, 'topics.json'), 'utf8'));
      for (const f of readdirSync(join(dir, 'packs', `fund-${track}`)).filter((x) => x !== 'manifest.json')) {
        expect(readFileSync(join(dir, 'packs', `fund-${track}`, f), 'utf8'), f).toBe(readFileSync(join(DEFAULT_PACKS_ROOT, `fund-${track}`, f), 'utf8'));
      }
      const committed = FundamentalsManifest.parse(JSON.parse(readFileSync(join(DEFAULT_TOPICS_ROOT, track, 'manifest.json'), 'utf8')));
      expect(committed.sha256).toBe(r.topicsManifest.sha256);
      expect(committed.counts).toEqual(r.counts);
      const pm = PackManifest.parse(JSON.parse(readFileSync(join(DEFAULT_PACKS_ROOT, `fund-${track}`, 'manifest.json'), 'utf8')));
      expect(pm.courses.map((c) => c.sha256)).toEqual(r.packManifest!.courses.map((c) => c.sha256));
    });
  }

  it('drills are re-keyed onto the fundamentals pack, on the language track, language-fluency', () => {
    const built = buildTrack('java', DEFAULT_AUTHORING_ROOT);
    const course = PackCourseFile.parse(built.courses[0]);
    for (const u of course.units) {
      expect(u.unit.key.startsWith(`fund-java/${course.course.id}/`)).toBe(true);
      expect(u.unit.track).toBe('java');
      expect(u.unit.competencies).toEqual(['language-fluency']);
      expect(u.unit.checks[0]!.spec.type).toBe('drill-java');
    }
    const file = FundamentalsFile.parse(built.topics);
    expect(file.topics[0]!.drillKeys).toEqual(course.units.map((u) => u.unit.key));
  });
});

describe('refusals (nothing written)', () => {
  const t = firstTopic('js');

  const refuses = (mutate: (x: ReturnType<typeof real>) => void, message: RegExp) => {
    const body = real('js', t);
    mutate(body);
    const root = authoring('js', { [body.topic]: body });
    expect(() => run('js', root)).toThrow(ImportError);
    expect(() => run('js', root)).toThrow(message);
    expect(() => readdirSync(join(dir, 'topics'))).toThrow(); // nothing written
  };

  it('a short lesson', () => refuses((x) => (x.lesson = 'too short'), /lesson has \d+ characters/));
  it('a quiz gate outside 8..12', () => refuses((x) => (x.quiz = x.quiz.slice(0, 7)), /quiz gate has 7 questions/));
  it('an answer outside the choices', () => refuses((x) => (x.quiz[0]!.answer = 9), /answer 9 is outside/));
  it('a duplicate choice', () => refuses((x) => (x.quiz[0]!.choices[1] = x.quiz[0]!.choices[0]!), /duplicate choice/));
  it('a blank explanation', () => refuses((x) => (x.quiz[0]!.explanation = ' '), /blank explanation/));
  it('keys piled on one position', () =>
    refuses((x) => {
      for (const q of x.quiz) {
        const key = q.choices[q.answer]!;
        q.choices = [key, ...q.choices.filter((c) => c !== key)];
        q.answer = 0;
      }
    }, /keyed answers sit at choice 1/));
  it('a flashcard that restates a keyed answer (FC-quiz xleak)', () =>
    refuses((x) => {
      const q = x.quiz.find((qq) => qq.choices[qq.answer]!.split(/\s+/).length >= 3)!;
      x.flashcards[0]!.back = `Remember: ${q.choices[q.answer]}.`;
    }, /restates Q\d+'s keyed answer/));
  it('a drill that breaks its drill bank rule (hint 3 as code)', () => refuses((x) => ((x.drills[0]!.hints as string[])[2] = 'return opts ?? {};'), /hint 3/));
  it('a file named differently from its topic', () => {
    const body = real('js', t);
    const root = authoring('js', { '01-other-name': body });
    expect(() => run('js', root)).toThrow(/file must be named/);
  });
  it('a topic of another track', () => {
    const body = real('js', t);
    const root = authoring('java', { [body.topic]: body });
    expect(() => run('java', root)).toThrow(/declares track js/);
  });
  it('a gap in the numbering', () => {
    const body = real('js', t);
    const root = authoring('js', { [body.topic]: body, '03-later': { ...body, topic: '03-later' } });
    expect(() => run('js', root)).toThrow(/without gaps/);
  });
  it('a census mismatch', () => {
    const body = real('js', t);
    const root = authoring('js', { [body.topic]: body });
    expect(() =>
      importFundamentals({ track: 'js', authoringRoot: root, topicsRoot: join(dir, 'topics'), packsRoot: join(dir, 'packs'), expected: { topics: 9, quiz: 9, flashcards: 9, drills: 9 } }),
    ).toThrow(/differ from the expected/);
  });
});
