/**
 * "Learn more" notes (GET /api/units/:id/notes) over the REAL stamped storefront quest pack and
 * its REAL stamped notes pack (content/seed/{quests,notes}/storefront). Every gate is tested:
 * locked act / track, readings before answering, explanations withheld before an answer and
 * released after it (missed questions: when their review card is due), /run never releases,
 * the endpoint writes nothing, and code units release only what reveal / pass already allow.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import request from 'supertest';
import type { Express } from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CAMPAIGN_FORMAT, type SeedNoteItem, type SeedQuizItem } from '@bootquest/shared';
import { UnitDetailResponse, UnitNotesResponse } from '@bootquest/shared/api';
import { createApp } from '../../src/api/app.ts';
import { mapContentStore } from '../../src/api/content-store.ts';
import { defaultRunners } from '../../src/api/runners.ts';
import { DAY_MS, fixedClock } from '../../src/engines/clock.ts';
import { loadCampaignIntoDb, readCampaign } from '../../src/store/campaign.ts';
import { ledgerCounts } from '../../src/store/queries.ts';
import { loadSeedItemStore, mapSeedItemStore, readSeedPackItems, SeedItemLoadError, verifyNotesBindings, type SeedItemStore } from '../../src/store/seed-items.ts';
import { loadStudyQuestsIntoDb } from '../../src/store/study-quests.ts';
import { noteLeaks } from '../../../tools/seed/src/factory/notes/notes.ts';
import { defaultFixtureTracks, quest, writeCampaignFixture, type FixtureTracks } from '../campaign-fixture.ts';
import { fakeDrillJs, fixture, seedFixture } from './harness.ts';
import { localNoon, makeTempDb, type TempDb } from '../helpers.ts';

const REPO = resolve(import.meta.dirname, '..', '..', '..');
const SEED = join(REPO, 'content', 'seed');
const QUESTS = join(SEED, 'quests', 'storefront');
const NOTES = join(SEED, 'notes', 'storefront');

const items = <T>(dir: string, kind: string): T[] =>
  (JSON.parse(readFileSync(join(dir, 'items.json'), 'utf8')) as { items: { kind: string }[] }).items.filter((i) => i.kind === kind) as T[];
const quizzes = items<SeedQuizItem>(QUESTS, 'quiz');
const notes = items<SeedNoteItem>(NOTES, 'note');
const keyed = (q: SeedQuizItem) => (q.check.choices ?? q.choices.map((c) => c.text))[q.check.answerKey as number]!;

function tracks(): FixtureTracks {
  const t = defaultFixtureTracks();
  const act = (actNo: number, qs: ReturnType<typeof quest>[], unlockLevel = 1) => ({ actNo, title: `Act ${actNo}`, theme: `t${actNo}`, unlockPct: 0.8, unlockLevel, locked: false, quests: qs });
  t.js = { format: CAMPAIGN_FORMAT, track: 'js', acts: [act(1, [quest('js', 'storefront', 'study-quest', 1)]), act(2, [quest('js', 'grok-js', 'study-quest', 2)], 2)] };
  return t;
}

let store: SeedItemStore;
beforeAll(() => {
  store = loadSeedItemStore([QUESTS, NOTES, join(SEED, 'quests', 'grok-js')]);
}, 120_000);

interface Ctx {
  tmp: TempDb;
  clock: ReturnType<typeof fixedClock>;
  app: Express;
}
function useNotesApi(): Ctx {
  const ctx = {} as Ctx;
  beforeEach(() => {
    ctx.tmp = makeTempDb();
    ctx.clock = fixedClock(localNoon(2026, 10, 1));
    loadCampaignIntoDb(ctx.tmp.db, readCampaign(writeCampaignFixture(join(ctx.tmp.dir, 'campaign'), tracks())), ctx.clock);
    loadStudyQuestsIntoDb(ctx.tmp.db, store, ctx.clock);
    ctx.app = createApp({ db: ctx.tmp.db, clock: ctx.clock, runners: defaultRunners(), seedItems: store });
  });
  afterEach(() => ctx.tmp.cleanup());
  return ctx;
}
const unitOf = (ctx: Ctx, repo: string) => ctx.tmp.db.get<{ id: number }>('SELECT id FROM unit WHERE key = ?', `campaign/js/${repo}`)!.id;
const getNotes = (ctx: Ctx, id: number) => request(ctx.app).get(`/api/units/${id}/notes`);

/** answers in SERVED order: the keyed choice text located in the served list, `wrong` items flipped */
async function answers(ctx: Ctx, id: number, wrong: ReadonlySet<string> = new Set()): Promise<number[]> {
  const d = UnitDetailResponse.parse((await request(ctx.app).get(`/api/units/${id}`)).body);
  const byKey = new Map(quizzes.map((q) => [q.key, q]));
  return d.studyQuest!.questions.map((q) => {
    const at = q.choices.indexOf(keyed(byKey.get(q.itemKey)!));
    return wrong.has(q.itemKey) ? (at + 1) % q.choices.length : at;
  });
}

describe('GET /api/units/:id/notes — study quests (storefront)', { timeout: 60_000 }, () => {
  const ctx = useNotesApi();

  it('before answering: every reading, no explanation (count only), "unlock after you answer", and no keyed answer anywhere', async () => {
    const res = await getNotes(ctx, unitOf(ctx, 'storefront'));
    expect(res.status).toBe(200);
    const body = UnitNotesResponse.parse(res.body);
    expect(body.source).toEqual({ repo: 'storefront', sha: '9d52bffef289c23d3136f868d201ba76b89a314c' });
    expect(body.readings.map((r) => r.id)).toEqual(['r01-start-here', 'r02-money-is-integer-cents', 'r03-rows-in-view-models-out']);
    expect(body.readings.every((r) => r.phase === 'before')).toBe(true);
    expect(body.readings[0]!.excerpts[0]!.url).toMatch(/^https:\/\/github\.com\/elirc\/storefront\/blob\/9d52bffef289c23d3136f868d201ba76b89a314c\/README\.md#L19-L20$/);
    expect(body.explanations).toMatchObject({ state: 'locked', released: [], withheld: 12, nextAt: null });
    expect(body.explanations.message).toContain('unlock after you answer');
    const text = JSON.stringify(body);
    for (const n of notes.filter((x) => x.phase === 'after')) {
      expect(text).not.toContain(n.title);
      expect(text).not.toContain(n.body.slice(0, 80));
    }
    // the readings themselves never carry a keyed answer of the pack (the validator's rule, re-checked here)
    for (const r of body.readings) expect(noteLeaks(r, quizzes), r.id).toEqual([]);
  });

  it('a locked campaign act serves nothing: 403 ACT_LOCKED; a locked track: 403 TRACK_LOCKED', async () => {
    const locked = await getNotes(ctx, unitOf(ctx, 'grok-js'));
    expect(locked.status).toBe(403);
    expect(locked.body.error.code).toBe('ACT_LOCKED');
    ctx.tmp.db.run('UPDATE track SET locked = 1 WHERE id = ?', 'js');
    const t = await getNotes(ctx, unitOf(ctx, 'storefront'));
    expect(t.status).toBe(403);
    expect(t.body.error.code).toBe('TRACK_LOCKED');
  });

  it('is read-only, and /run (refused for study quizzes) never releases an explanation', async () => {
    const id = unitOf(ctx, 'storefront');
    const before = ledgerCounts(ctx.tmp.db);
    const reviews = ctx.tmp.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_item')!.n;
    await getNotes(ctx, id);
    const run = await request(ctx.app).post(`/api/units/${id}/run`).send({ answers: await answers(ctx, id) });
    expect(run.status).toBe(409);
    const body = UnitNotesResponse.parse((await getNotes(ctx, id)).body);
    expect(body.explanations.state).toBe('locked');
    expect(ledgerCounts(ctx.tmp.db)).toEqual(before);
    expect(ctx.tmp.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_item')!.n).toBe(reviews);
  });

  it('after a passing submit every explanation is released (one per quiz), with links', async () => {
    const id = unitOf(ctx, 'storefront');
    const sub = await request(ctx.app).post(`/api/units/${id}/submit`).send({ answers: await answers(ctx, id) });
    expect(sub.status).toBe(200);
    expect(sub.body.verdict).toBe('pass');
    const body = UnitNotesResponse.parse((await getNotes(ctx, id)).body);
    expect(body.explanations.state).toBe('released');
    expect(body.explanations.withheld).toBe(0);
    expect(body.explanations.released.map((n) => n.target).sort()).toEqual(quizzes.map((q) => q.key).sort());
    expect(body.explanations.released.every((n) => n.phase === 'after' && n.targetKind === 'quiz')).toBe(true);
  });

  it('after a FAILED submit: the questions answered right are explained now; a missed one waits for its review card (due tomorrow)', async () => {
    const id = unitOf(ctx, 'storefront');
    const missed = new Set(quizzes.slice(0, 3).map((q) => q.key)); // 9/12 = 75% < 80%: a fail
    const sub = await request(ctx.app).post(`/api/units/${id}/submit`).send({ answers: await answers(ctx, id, missed) });
    expect(sub.body.verdict).toBe('fail');
    const now = ctx.clock().getTime();
    const day0 = UnitNotesResponse.parse((await getNotes(ctx, id)).body);
    expect(day0.explanations.state).toBe('partial');
    expect(day0.explanations.withheld).toBe(3);
    expect(day0.explanations.nextAt).toBe(now + DAY_MS);
    const released = new Set(day0.explanations.released.map((n) => n.target));
    for (const k of missed) expect(released.has(k)).toBe(false);
    expect(released.size).toBe(9);
    // no missed question's keyed answer leaks the day it was missed (a retry with the key in hand)
    const text = JSON.stringify(day0);
    for (const n of notes.filter((x) => missed.has(x.target))) expect(text).not.toContain(n.title);
    // the review card for a miss is due tomorrow: the same moment its explanation is released
    ctx.clock.advance(DAY_MS);
    const day1 = UnitNotesResponse.parse((await getNotes(ctx, id)).body);
    expect(day1.explanations.state).toBe('released');
    expect(day1.explanations.released).toHaveLength(12);
    const queue = (await request(ctx.app).get('/api/reviews/queue')).body as { items: { cardKey: string; unitId: number }[] };
    expect(queue.items.filter((i) => i.cardKey.startsWith('quiz-miss:')).map((i) => i.cardKey.slice('quiz-miss:'.length)).sort()).toEqual([...missed].sort());
  });

  it('404 for an unknown unit', async () => {
    expect((await getNotes(ctx, 999_999)).status).toBe(404);
  });
});

describe('GET /api/units/:id/notes — code units', () => {
  let tmp: TempDb;
  let app: Express;
  let ids: Map<string, number>;
  beforeEach(() => {
    tmp = makeTempDb();
    const clock = fixedClock(localNoon(2026, 10, 1));
    ids = seedFixture(tmp.db, clock);
    const content = { ...fixture.content, 'fixture:drill-add': { ...fixture.content['fixture:drill-add'], explanation: 'EXPLANATION_MARKER: add returns a + b.' } };
    app = createApp({ db: tmp.db, clock, runners: { 'drill-js': fakeDrillJs }, content: mapContentStore(content) });
  });
  afterEach(() => tmp.cleanup());

  it('before a pass or reveal: refs only, explanation withheld, no solution', async () => {
    const body = UnitNotesResponse.parse((await request(app).get(`/api/units/${ids.get('fixture:drill-add')}/notes`)).body);
    expect(body).toMatchObject({ readings: [], explanation: null, solution: null, source: null });
    expect(body.explanations.state).toBe('locked');
    expect(JSON.stringify(body)).not.toContain('EXPLANATION_MARKER');
    expect(JSON.stringify(body)).not.toContain(fixture.submissions.addRight.trim().slice(0, 20));
  });

  it('a verified pass releases the explanation, not the solution', async () => {
    const id = ids.get('fixture:drill-add')!;
    const sub = await request(app).post(`/api/units/${id}/submit`).send({ code: fixture.submissions.addRight });
    expect(sub.body.verdict).toBe('pass');
    const body = UnitNotesResponse.parse((await request(app).get(`/api/units/${id}/notes`)).body);
    expect(body.explanation).toContain('EXPLANATION_MARKER');
    expect(body.explanations.state).toBe('released');
    expect(body.solution).toBeNull();
  });

  it('a failed submit releases nothing; a reveal releases the explanation and the solution /solution serves', async () => {
    const id = ids.get('fixture:drill-add')!;
    await request(app).post(`/api/units/${id}/submit`).send({ code: fixture.submissions.addWrong });
    expect(UnitNotesResponse.parse((await request(app).get(`/api/units/${id}/notes`)).body).explanation).toBeNull();
    const rev = await request(app).post(`/api/units/${id}/reveal`).send({});
    expect(rev.status).toBe(200);
    const body = UnitNotesResponse.parse((await request(app).get(`/api/units/${id}/notes`)).body);
    expect(body.explanation).toContain('EXPLANATION_MARKER');
    expect(body.solution).toEqual(rev.body.solution);
  });

  it('a unit without an explanation says so', async () => {
    const body = UnitNotesResponse.parse((await request(app).get(`/api/units/${ids.get('fixture:drill-mul')}/notes`)).body);
    expect(body.explanations.state).toBe('none');
  });
});

describe('notes loader (store/seed-items.ts)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'bq-notes-load-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('refuses notes whose quest pack is not loaded', () => {
    expect(() => verifyNotesBindings([NOTES])).toThrow(/annotates quest pack storefront, which is not loaded/);
    expect(() => mapSeedItemStore(readSeedPackItems(NOTES))).toThrow(SeedItemLoadError);
  });

  it('refuses STALE notes: the quest pack bytes changed since the notes were validated', () => {
    const q = join(tmp, 'seed', 'quests', 'storefront');
    const n = join(tmp, 'seed', 'notes', 'storefront');
    cpSync(QUESTS, q, { recursive: true });
    cpSync(NOTES, n, { recursive: true });
    expect(() => verifyNotesBindings([q, n])).not.toThrow();
    writeFileSync(join(q, 'items.json'), `${readFileSync(join(q, 'items.json'), 'utf8')} `);
    expect(() => verifyNotesBindings([q, n])).toThrow(/stale notes — quest pack storefront items\.json/);
  });

  it('refuses a note that targets an item its quest pack does not have, or an after note on a non-quiz', () => {
    const qs = readSeedPackItems(QUESTS);
    const note = notes.find((x) => x.phase === 'after')!;
    expect(() => mapSeedItemStore([...qs, { ...note, target: 'seed:quests:storefront/quiz/0000000000000000' }])).toThrow(/not an item of the loaded storefront quest pack/);
    const fc = qs.find((i) => (i as { kind: string }).kind === 'flashcard') as { key: string };
    expect(() => mapSeedItemStore([...qs, { ...note, target: fc.key }])).toThrow(/targets a flashcard, not a quiz/);
    expect(mapSeedItemStore([...qs, ...readSeedPackItems(NOTES)]).notes('storefront')).toHaveLength(15);
  });
});
