/**
 * f52 lesson aids (wave B ruling 7): content/fundamentals/sections.json + GET /units/:id/lesson-aids.
 *   - the committed map: every track / topic exists, every question number is 1..quiz length, every heading
 *     is a `##`/`###` heading of that topic's lesson, every committed topic has a full gate map, and the checks
 *     (js 01-05: every heading once; every other topic: two, rv wave T9) restate no quiz key or flashcard back;
 *   - a bad entry logs one warning and is skipped, the rest loads; a missing / malformed file never throws;
 *   - the endpoint serves { gate, checks } for a Fundamentals topic unit and empty aids for any other unit.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { LessonAidsResponse } from '@bootquest/shared/api-ext';
import { FundamentalsFile, fundTopicUnitKey } from '@bootquest/shared/fundamentals';
import { createApp } from '../../src/api/app.ts';
import { fixedClock } from '../../src/engines/clock.ts';
import { insertUnit } from '../../src/store/content.ts';
import { defaultFundamentalsDirs, lessonHeadings, loadFundamentalsIntoDb, loadFundStore, mapFundStore, readFundSections } from '../../src/store/fundamentals.ts';
import { getUnitByKey } from '../../src/store/queries.ts';
import { emptySeedItemStore, withFundamentals } from '../../src/store/seed-items.ts';
import { localNoon, makeTempDb, type TempDb } from '../helpers.ts';

const REPO = resolve(import.meta.dirname, '..', '..', '..');
const FUND = join(REPO, 'content', 'fundamentals');
const TRACKS = ['js', 'csharp', 'java'] as const;
const PILOT = ['01', '02', '03', '04', '05'];

const readTrack = (track: string): FundamentalsFile => FundamentalsFile.parse(JSON.parse(readFileSync(join(FUND, track, 'topics.json'), 'utf8')));
/** topics committed in content/fundamentals/<track>/topics.json, across the three tracks */
const COMMITTED_TOPICS = TRACKS.reduce((n, track) => n + readTrack(track).topics.length, 0);

describe('lessonHeadings', () => {
  it('returns ## and ### heading texts in order, skipping fenced code and other levels', () => {
    const lesson = ['# Title', '## First `a` part', 'text', '```js', '## not a heading', '```', '### Sub  ', '#### Too deep', '~~~', '### fenced', '~~~', '##NoSpace', '## Last'].join('\n');
    expect(lessonHeadings(lesson)).toEqual(['First `a` part', 'Sub', 'Last']);
  });
});

describe('content/fundamentals/sections.json (committed)', () => {
  const raw = JSON.parse(readFileSync(join(FUND, 'sections.json'), 'utf8')) as Record<string, Record<string, { gate?: Record<string, string>; checks?: { heading: string; prompt: string; answer: string }[] }>>;

  it('names only real topics, question numbers 1..quiz length and exact lesson headings', () => {
    const bad: string[] = [];
    expect(Object.keys(raw).sort()).toEqual([...TRACKS].sort());
    for (const [track, byTopic] of Object.entries(raw)) {
      const topics = new Map(readTrack(track).topics.map((t) => [t.id, t]));
      for (const [id, entry] of Object.entries(byTopic)) {
        const topic = topics.get(id);
        if (!topic) {
          bad.push(`${track}/${id}: unknown topic`);
          continue;
        }
        expect(Object.keys(entry).every((k) => k === 'gate' || k === 'checks'), `${track}/${id} fields`).toBe(true);
        const headings = new Set(lessonHeadings(topic.lesson));
        for (const [n, h] of Object.entries(entry.gate ?? {})) {
          if (!/^[1-9]\d*$/.test(n) || Number(n) > topic.quiz.length) bad.push(`${track}/${id}: question ${n} outside 1..${topic.quiz.length}`);
          if (!headings.has(h)) bad.push(`${track}/${id} q${n}: "${h}" is not a lesson heading`);
        }
        for (const c of entry.checks ?? []) if (!headings.has(c.heading)) bad.push(`${track}/${id} check: "${c.heading}" is not a lesson heading`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('loads without a warning and every committed topic has a full gate map', () => {
    const store = loadFundStore(defaultFundamentalsDirs(FUND), { warn: (m) => expect.fail(m) });
    let topics = 0;
    const partial: string[] = [];
    for (const track of TRACKS) {
      for (const topic of store.topics(track)) {
        topics++;
        const gate = store.lessonAids(track, topic.id).gate;
        const want = topic.quiz.map((_, i) => String(i + 1));
        if (JSON.stringify(Object.keys(gate).sort()) !== JSON.stringify([...want].sort())) partial.push(`${track}/${topic.id}: ${Object.keys(gate).length}/${topic.quiz.length}`);
      }
    }
    expect(partial).toEqual([]);
    expect(COMMITTED_TOPICS).toBeGreaterThanOrEqual(60);
    expect(topics).toBe(COMMITTED_TOPICS);
  });

  // rv wave (T9, pretest): every topic has check-yourself cards. The js 01-05 pilot keeps one per lesson heading;
  // every other topic has exactly two, on two different headings, in lesson order.
  it('checks: js 01-05 one per heading, every other topic two, in lesson order, no quiz key or flashcard back restated', () => {
    const problems: string[] = [];
    const norm = (s: string) => s.toLowerCase().replace(/[`*]/g, '').replace(/\s+/g, ' ').trim();
    for (const track of TRACKS) for (const topic of readTrack(track).topics) {
      const checks = raw[track]?.[topic.id]?.checks ?? [];
      const headings = lessonHeadings(topic.lesson);
      if (track === 'js' && PILOT.includes(topic.id.slice(0, 2))) expect(checks.map((c) => c.heading), topic.id).toEqual(headings);
      else {
        expect(checks, `${track}/${topic.id} checks`).toHaveLength(2);
        const at = checks.map((c) => headings.indexOf(c.heading));
        if (!(at[0]! >= 0 && at[1]! > at[0]!)) problems.push(`${track}/${topic.id}: the two checks are not on two headings in lesson order`);
      }
      const keys = topic.quiz.map((q) => norm(q.choices[q.answer]!)).filter((k) => k.length >= 12);
      const backs = topic.flashcards.map((c) => norm(c.back));
      const prompts = topic.quiz.map((q) => norm(q.prompt));
      for (const c of checks) {
        const p = norm(c.prompt);
        const a = norm(c.answer);
        if (keys.some((k) => a.includes(k) || p.includes(k))) problems.push(`${topic.id} "${c.heading}": restates a quiz key`);
        if (backs.some((b) => a.includes(b) || b.includes(a))) problems.push(`${topic.id} "${c.heading}": restates a flashcard back`);
        if (prompts.includes(p)) problems.push(`${topic.id} "${c.heading}": is a gate question`);
        const sentences = c.answer.split(/(?<=[.!?])\s+/).filter((s) => s.trim() !== '').length;
        if (sentences < 1 || sentences > 3) problems.push(`${topic.id} "${c.heading}": answer is ${sentences} sentences`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('readFundSections (warn and skip)', () => {
  let dir = '';
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it('a missing file is no aids; a malformed file warns; each bad entry warns once and is skipped, the rest loads', () => {
    dir = mkdtempSync(join(tmpdir(), 'bq-sections-'));
    const js = readTrack('js');
    const t1 = js.topics[0]!;
    const t2 = js.topics[1]!;
    const [h1, h2] = lessonHeadings(t1.lesson);
    const warnings: string[] = [];
    const warn = (m: string) => warnings.push(m);
    expect(readFundSections([join(dir, 'nope.json')], [js], warn).size).toBe(0);
    writeFileSync(join(dir, 'bad.json'), '{ not json');
    expect(readFundSections([join(dir, 'bad.json')], [js], warn).size).toBe(0);
    writeFileSync(join(dir, 'arr.json'), '[]');
    expect(readFundSections([join(dir, 'arr.json')], [js], warn).size).toBe(0);
    expect(warnings).toHaveLength(2);
    warnings.length = 0;

    writeFileSync(
      join(dir, 'mixed.json'),
      JSON.stringify({
        js: {
          [t1.id]: {
            gate: { '1': h1, '2': 'No such heading', '0': h1, '11': h1, x: h1, '10': h2, '3': 7 },
            checks: [{ heading: h1, prompt: 'p', answer: 'a' }, { heading: 'Nope', prompt: 'p', answer: 'a' }, { heading: h2, prompt: '', answer: 'a' }, 'str'],
            extra: true,
          },
          '99-no-such-topic': { gate: { '1': h1 } },
          [t2.id]: 'nope',
        },
        csharp: { '01-x': {} }, // not a loaded track here
      }),
    );
    const m = readFundSections([join(dir, 'mixed.json')], [js], warn);
    expect(m.get('js')?.get(t1.id)).toEqual({ gate: { '1': h1, '10': h2 }, checks: [{ heading: h1, prompt: 'p', answer: 'a' }] });
    expect(m.get('js')?.has(t2.id)).toBe(false);
    expect(m.get('js')?.has('99-no-such-topic')).toBe(false);
    expect(m.has('csharp')).toBe(false);
    // gate: bad heading, 0, 11, x, non-string = 5; checks: bad heading, empty prompt, 'str' = 3; extra field;
    // unknown topic; non-object topic; unknown track
    expect(warnings).toHaveLength(12);
    expect(warnings.some((w) => w.includes('"11" is not 1..10'))).toBe(true);
    expect(warnings.some((w) => w.includes('"No such heading" is not a heading'))).toBe(true);
    expect(warnings.some((w) => w.includes('99-no-such-topic: not a topic'))).toBe(true);
  });

  it('loadFundStore never fails boot on a broken sections file', () => {
    dir = mkdtempSync(join(tmpdir(), 'bq-sections-'));
    writeFileSync(join(dir, 'sections.json'), '{ broken');
    const warnings: string[] = [];
    const store = loadFundStore([join(FUND, 'js')], { sectionsPaths: [join(dir, 'sections.json')], relatedPaths: [], warn: (m) => warnings.push(m) });
    expect(store.topics('js')).toHaveLength(readTrack('js').topics.length);
    expect(store.lessonAids('js', store.topics('js')[0]!.id)).toEqual({ gate: {}, checks: [] });
    expect(warnings).toHaveLength(1);
  });
});

describe('GET /units/:id/lesson-aids', () => {
  let tmp: TempDb;
  afterEach(() => tmp.cleanup());

  it('serves the topic gate map + checks for a Fundamentals topic unit, empty aids for any other unit, 404 for none', async () => {
    tmp = makeTempDb();
    const clock = fixedClock(localNoon(2026, 11, 9));
    const js = readTrack('js');
    const [t1, t2] = js.topics;
    const [h1, h2] = lessonHeadings(t1!.lesson);
    const sections = new Map([['js', new Map([[t1!.id, { gate: { '1': h1!, '2': h2! }, checks: [{ heading: h1!, prompt: 'What is x?', answer: 'It is y.' }] }]])]]);
    const store = mapFundStore([js], new Map(), sections);
    loadFundamentalsIntoDb(tmp.db, store, clock);
    const drill = insertUnit(tmp.db, { key: 'aids/drill', track: 'js', kind: 'drill', title: 'd', difficulty: 1, checks: [{ spec: { type: 'drill-js', language: 'js', tests: [{ name: 't', code: 'assert.ok(true)' }] } }] }, clock);
    const app = createApp({ db: tmp.db, clock, seedItems: withFundamentals(emptySeedItemStore, store) });
    const idOf = (topicId: string) => getUnitByKey(tmp.db, fundTopicUnitKey('js', topicId))!.id;

    const res = await request(app).get(`/api/units/${idOf(t1!.id)}/lesson-aids`);
    expect(res.status).toBe(200);
    expect(LessonAidsResponse.parse(res.body)).toEqual({ gate: { '1': h1, '2': h2 }, checks: [{ heading: h1, prompt: 'What is x?', answer: 'It is y.' }] });
    // headings only: no quiz choice text in the gate map
    const choices = new Set(t1!.quiz.flatMap((q) => q.choices));
    expect(Object.values(res.body.gate as Record<string, string>).some((h) => choices.has(h))).toBe(false);

    expect((await request(app).get(`/api/units/${idOf(t2!.id)}/lesson-aids`)).body).toEqual({ gate: {}, checks: [] });
    expect((await request(app).get(`/api/units/${drill}/lesson-aids`)).body).toEqual({ gate: {}, checks: [] });
    expect((await request(app).get('/api/units/99999/lesson-aids')).status).toBe(404);
    expect((await request(app).get(`/api/units/${drill}/lesson-aids?x=1`)).status).toBe(400);

    // a server without the Fundamentals store: empty aids, never an error
    const bare = createApp({ db: tmp.db, clock });
    expect((await request(bare).get(`/api/units/${idOf(t1!.id)}/lesson-aids`)).body).toEqual({ gate: {}, checks: [] });
  });
});
