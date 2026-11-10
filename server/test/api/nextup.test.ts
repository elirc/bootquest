// f52 C8: the dashboard's nextUp never offers an explain-back / patch kata (answered from memory) while the
// track has any other available unit; on a track where those are all there is, it prefers one whose repo's
// study quest is passed, else keeps the first available one (the old rule).
import request from 'supertest';
import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DashboardResponseExt } from '@bootquest/shared/api-ext';
import { createApp } from '../../src/api/app.ts';
import type { Db } from '../../src/db/database.ts';
import { fixedClock } from '../../src/engines/clock.ts';
import { insertUnit } from '../../src/store/content.ts';
import { localNoon, makeTempDb, submit, type TempDb } from '../helpers.ts';

const eb = (key: string, track: string) => ({ key, track, kind: 'explain-back', title: key, checks: [{ spec: { type: 'explain-back', questionSetKey: `eb:${key}` } }] });
const kata = (key: string, track: string) => ({ key, track, kind: 'patch-kata', title: key, checks: [{ spec: { type: 'patch-kata', kataKey: `kata:${key}`, defectCount: 1 } }] });
const drill = (key: string, track: string) => ({ key, track, kind: 'drill', title: key, difficulty: 1, checks: [{ spec: { type: 'drill-js', language: 'js', tests: [{ name: 't', code: 'assert.ok(true)' }] } }] });
const study = (key: string, track: string) => ({ key, track, kind: 'study', title: key, checks: [{ spec: { type: 'study-quiz', itemKeys: [`${key}:q`] } }] });

describe('GET /api/dashboard nextUp (f52 C8)', () => {
  let tmp: TempDb;
  let db: Db;
  let clock: ReturnType<typeof fixedClock>;
  let app: Express;
  const id = (key: string) => db.get<{ id: number }>('SELECT id FROM unit WHERE key = ?', key)!.id;
  beforeEach(() => {
    tmp = makeTempDb();
    db = tmp.db;
    clock = fixedClock(localNoon(2026, 10, 1));
    // js: the explain-back and the kata have the LOWEST ids; the drill comes after them
    for (const u of [
      eb('ladder/explain-back/js-repo/aaaaaaaaaaaa', 'js'),
      kata('ladder/kata/js-repo/bbbbbbbbbbbb', 'js'),
      drill('bank/js/01', 'js'),
      // agentic: answered-from-memory units only
      eb('ladder/g2/repo-a/cccccccccccc', 'agentic'),
      kata('ladder/kata/repo-b/dddddddddddd', 'agentic'),
      eb('ladder/g2/repo-c/eeeeeeeeeeee', 'agentic'),
      // the study quests of repo-c and repo-b live on another track
      study('ladder/study/repo-c/ffffffffffff', 'sysdesign'),
      study('ladder/study/repo-b/gggggggggggg', 'sysdesign'),
    ]) {
      insertUnit(db, u, clock);
    }
    app = createApp({ db, clock });
  });
  afterEach(() => tmp.cleanup());

  const nextUp = async (track: string) => {
    const res = await request(app).get('/api/dashboard');
    expect(res.status).toBe(200);
    return DashboardResponseExt.parse(res.body).nextUp.find((n) => n.trackId === track)?.unit?.key ?? null;
  };

  it('a track with any other available unit never gets an explain-back or kata', async () => {
    expect(await nextUp('js')).toBe('bank/js/01');
    submit(db, clock, id('bank/js/01'));
    // nothing else is open: the old rule (first available) applies
    expect(await nextUp('js')).toBe('ladder/explain-back/js-repo/aaaaaaaaaaaa');
  });

  it('answered-from-memory only: prefer the one whose repo study quest is passed, else the first', async () => {
    expect(await nextUp('agentic')).toBe('ladder/g2/repo-a/cccccccccccc');
    submit(db, clock, id('ladder/study/repo-c/ffffffffffff')); // verdict simulated
    expect(await nextUp('agentic')).toBe('ladder/g2/repo-c/eeeeeeeeeeee');
    submit(db, clock, id('ladder/study/repo-b/gggggggggggg'));
    expect(await nextUp('agentic')).toBe('ladder/kata/repo-b/dddddddddddd'); // first studied one in served order
  });
});
