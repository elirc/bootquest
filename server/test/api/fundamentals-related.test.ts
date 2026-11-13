/**
 * f52 C3 (W2.4): the Fundamentals "More practice" map, content/fundamentals/related.json.
 *   - every key in the committed map resolves against the REAL packs (a live, non-quarantined drill of the
 *     topic's track), every topic of the three tracks is listed (an explicit [] is allowed, R1-09), and no list is longer than 8;
 *   - GET /tracks/:id/fundamentals serves `related` per topic (UnitSummary, lock state included); a key that
 *     is not a live drill of the track is skipped; a topic without one has no `related` field;
 *   - a missing or malformed map never refuses startup (warnings only).
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { FundamentalsResponseExt } from '@bootquest/shared/api-ext';
import { FundamentalsFile } from '@bootquest/shared/fundamentals';
import { createApp } from '../../src/api/app.ts';
import { fixedClock } from '../../src/engines/clock.ts';
import { insertUnit } from '../../src/store/content.ts';
import { defaultFundamentalsDirs, loadFundamentalsIntoDb, loadFundStore, mapFundStore, readFundRelated, relatedKeyProblems } from '../../src/store/fundamentals.ts';
import { emptySeedItemStore, withFundamentals } from '../../src/store/seed-items.ts';
import { localNoon, makeTempDb, type TempDb } from '../helpers.ts';

const REPO = resolve(import.meta.dirname, '..', '..', '..');
const FUND = join(REPO, 'content', 'fundamentals');
const PACKS = join(REPO, 'content', 'packs');

/** every live (non-quarantined) unit of the committed code packs: key -> kind + track */
function realPackUnits(): Map<string, { kind: string; track: string }> {
  const out = new Map<string, { kind: string; track: string }>();
  for (const source of readdirSync(PACKS)) {
    const dir = join(PACKS, source);
    const quarantined = new Set((JSON.parse(readFileSync(join(dir, 'quarantine.json'), 'utf8')) as { entries: { key: string }[] }).entries.map((e) => e.key));
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json') && !['manifest.json', 'quarantine.json', 'validation.json', 'review-queue.json'].includes(x))) {
      const doc = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { units?: { unit: { key: string; kind: string; track: string } }[] };
      for (const u of doc.units ?? []) if (!quarantined.has(u.unit.key)) out.set(u.unit.key, { kind: u.unit.kind, track: u.unit.track });
    }
  }
  return out;
}

describe('content/fundamentals/related.json (committed)', () => {
  // rv wave (R1-09): an off-topic stand-in is worse than none, so a topic may list [] explicitly ("no matching
  // practice yet"), but every topic must still appear in the map so that a missing entry stays a visible mistake
  it('every key is a live drill of the topic track in the real packs; every topic is listed; at most 8 per topic', () => {
    const units = realPackUnits();
    const store = loadFundStore(defaultFundamentalsDirs(FUND), { warn: (m) => expect.fail(m) });
    const bad: string[] = [];
    let topics = 0;
    const listed = JSON.parse(readFileSync(join(FUND, 'related.json'), 'utf8')) as Record<string, Record<string, unknown>>;
    for (const track of ['js', 'csharp', 'java'] as const) {
      for (const topic of store.topics(track)) {
        topics++;
        const keys = store.related(track, topic.id);
        if (!Array.isArray(listed[track]?.[topic.id])) bad.push(`${track}/${topic.id}: not listed in related.json`);
        if (keys.length > 8) bad.push(`${track}/${topic.id}: ${keys.length} keys`);
        for (const k of keys) {
          const u = units.get(k);
          if (!u) bad.push(`${track}/${topic.id}: ${k} is not a live pack unit`);
          else if (u.kind !== 'drill' || u.track !== track) bad.push(`${track}/${topic.id}: ${k} is a ${u.track} ${u.kind}`);
          if (k.startsWith('fund-')) bad.push(`${track}/${topic.id}: ${k} is a Fundamentals drill (already in drills)`);
        }
      }
    }
    expect(bad).toEqual([]);
    // every committed topic, across the three tracks' topics.json
    const committed = (['js', 'csharp', 'java'] as const).reduce((n, track) => n + FundamentalsFile.parse(JSON.parse(readFileSync(join(FUND, track, 'topics.json'), 'utf8'))).topics.length, 0);
    expect(committed).toBeGreaterThanOrEqual(60);
    expect(topics).toBe(committed);
    // the map names only real topics
    const raw = JSON.parse(readFileSync(join(FUND, 'related.json'), 'utf8')) as Record<string, Record<string, string[]>>;
    for (const [track, byTopic] of Object.entries(raw)) {
      const ids = new Set(store.topics(track as 'js').map((t) => t.id));
      for (const id of Object.keys(byTopic)) expect(ids.has(id), `${track}/${id}`).toBe(true);
    }
  });
});

describe('readFundRelated', () => {
  let dir = '';
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it('a missing file is no related units; a malformed file or entry warns and is skipped, never throws', () => {
    dir = mkdtempSync(join(tmpdir(), 'bq-related-'));
    const warnings: string[] = [];
    const warn = (m: string) => warnings.push(m);
    expect(readFundRelated([join(dir, 'nope.json')], warn).size).toBe(0);
    writeFileSync(join(dir, 'bad.json'), '{ not json');
    expect(readFundRelated([join(dir, 'bad.json')], warn).size).toBe(0);
    writeFileSync(join(dir, 'mixed.json'), JSON.stringify({ js: { '01-x': ['a', 7, 'a', 'b'], '02-y': 'nope' }, java: [] }));
    const m = readFundRelated([join(dir, 'mixed.json')], warn);
    expect(m.get('js')?.get('01-x')).toEqual(['a', 'b']);
    expect(m.get('js')?.has('02-y')).toBe(false);
    expect(warnings).toHaveLength(5); // bad JSON, 7, duplicate 'a', '02-y', java
  });
});

describe('GET /tracks/:id/fundamentals `related`', () => {
  let tmp: TempDb;
  afterEach(() => tmp.cleanup());

  it('serves the live drills of the track in listed order; skips unknown keys, other kinds and other tracks', async () => {
    tmp = makeTempDb();
    const clock = fixedClock(localNoon(2026, 11, 9));
    const js = FundamentalsFile.parse(JSON.parse(readFileSync(join(FUND, 'js', 'topics.json'), 'utf8')));
    const t1 = js.topics[0]!.id;
    const drill = (key: string, track = 'js', prerequisites: string[] = []) =>
      insertUnit(tmp.db, { key, track, kind: 'drill', title: key, difficulty: 1, prerequisites, checks: [{ spec: { type: 'drill-js', language: 'js', tests: [{ name: 't', code: 'assert.ok(true)' }] } }] }, clock);
    drill('rel/b');
    drill('rel/a', 'js', ['rel/b']);
    drill('rel/cs', 'csharp');
    insertUnit(tmp.db, { key: 'rel/quiz', track: 'js', kind: 'quiz', title: 'q', checks: [{ spec: { type: 'quiz', itemKey: 'q', grading: 'choice', answerKey: 0, choices: ['a', 'b'] } }] }, clock);
    const store = mapFundStore([js], new Map([['js', new Map([[t1, ['rel/a', 'rel/missing', 'rel/quiz', 'rel/cs', 'rel/b']]])]]));
    loadFundamentalsIntoDb(tmp.db, store, clock);
    const app = createApp({ db: tmp.db, clock, seedItems: withFundamentals(emptySeedItemStore, store) });
    const res = await request(app).get('/api/tracks/js/fundamentals');
    expect(res.status).toBe(200);
    const body = FundamentalsResponseExt.parse(res.body);
    expect(body.topics[0]!.related?.map((u) => [u.key, u.kind, u.state])).toEqual([
      ['rel/a', 'drill', 'locked'],
      ['rel/b', 'drill', 'available'],
    ]);
    expect(body.topics.slice(1).every((t) => !('related' in t))).toBe(true);
    expect(relatedKeyProblems(tmp.db, store)).toEqual([`js/${t1}: rel/missing is not a live unit`, `js/${t1}: rel/quiz is a quiz, not a drill`, `js/${t1}: rel/cs is on track csharp`]);
  });
});
