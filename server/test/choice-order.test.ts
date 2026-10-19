/**
 * ui-audit #24 (HONESTY): the served choice order (server/src/api/choice-order.ts) and the
 * per-DB secret that keys it (migration 009).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { UnitDetailResponse, SubmitResponse, RevealResponse } from '@bootquest/shared/api';
import { createApp } from '../src/api/app.ts';
import { choiceOrderSecret, choicePermutation, ChoiceOrderSecretError, toServedIndex, toStoredAnswer } from '../src/api/choice-order.ts';
import { openDb } from '../src/db/database.ts';
import { insertUnit } from '../src/store/content.ts';
import { fixedClock } from '../src/engines/clock.ts';
import { localNoon, makeTempDb, type TempDb } from './helpers.ts';

const SECRET = 'a'.repeat(64);

describe('choicePermutation (pure)', () => {
  it('is a permutation of [0, n), deterministic for (secret, scope, n)', () => {
    for (const n of [1, 2, 3, 4, 5, 9]) {
      const p = choicePermutation(SECRET, 'unit:1\u0000item:x', n);
      expect([...p].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i));
      expect(choicePermutation(SECRET, 'unit:1\u0000item:x', n)).toEqual(p);
    }
    expect(choicePermutation(SECRET, 's', 0)).toEqual([]);
  });

  it('depends on the secret and on the scope (unit + item)', () => {
    const scopes = Array.from({ length: 30 }, (_, i) => `unit:${i}\u0000item:k`);
    const a = scopes.map((s) => choicePermutation(SECRET, s, 4).join(''));
    const b = scopes.map((s) => choicePermutation('b'.repeat(64), s, 4).join(''));
    expect(a).not.toEqual(b);
    expect(new Set(a).size).toBeGreaterThan(5);
  });

  it('spreads a fixed stored index across served positions (no position bias survives)', () => {
    const counts = [0, 0, 0, 0];
    const N = 4000;
    for (let i = 0; i < N; i++) counts[toServedIndex(0, choicePermutation(SECRET, `item:${i}`, 4))]! += 1;
    for (const c of counts) expect(Math.abs(c / N - 0.25)).toBeLessThan(0.03);
  });

  it('maps served <-> stored; non-index answers pass through unchanged', () => {
    const order = [2, 0, 3, 1]; // served i shows stored order[i]
    expect([0, 1, 2, 3].map((i) => toStoredAnswer(i, order))).toEqual([2, 0, 3, 1]);
    expect([0, 1, 2, 3].map((s) => toServedIndex(s, order))).toEqual([1, 3, 0, 2]);
    for (const odd of [-1, 4, 1.5, 'text']) expect(toStoredAnswer(odd, order)).toBe(odd);
  });
});

describe('migration 009: the per-DB choice-order secret', () => {
  let tmp: TempDb;
  beforeEach(() => {
    tmp = makeTempDb();
  });
  afterEach(() => tmp.cleanup());

  it('exists once (64 hex), survives a re-open unchanged, and differs per DB', () => {
    const s = choiceOrderSecret(tmp.db);
    expect(s).toMatch(/^[0-9a-f]{64}$/);
    // a second handle re-runs the migrations (nothing pending) and reads the same row
    const again = openDb({ path: tmp.path, env: {} });
    try {
      expect(choiceOrderSecret(again)).toBe(s);
    } finally {
      again.close();
    }
    const other = makeTempDb();
    try {
      expect(choiceOrderSecret(other.db)).not.toBe(s);
    } finally {
      other.cleanup();
    }
  });

  it('is immutable: UPDATE, DELETE, REPLACE and a second row are refused', () => {
    const s = choiceOrderSecret(tmp.db);
    expect(() => tmp.db.run(`UPDATE server_secret SET secret = ?`, 'b'.repeat(64))).toThrow(/immutable/);
    expect(() => tmp.db.run(`DELETE FROM server_secret`)).toThrow(/immutable/);
    expect(() => tmp.db.run(`INSERT OR REPLACE INTO server_secret (id, secret) VALUES (1, ?)`, 'c'.repeat(64))).toThrow();
    expect(() => tmp.db.run(`INSERT INTO server_secret (id, secret) VALUES (2, ?)`, 'd'.repeat(64))).toThrow();
    expect(tmp.db.all<{ secret: string }>('SELECT secret FROM server_secret')).toEqual([{ secret: s }]);
  });

  it('fails closed when the secret row is missing (never serves the authored order)', () => {
    const raw = makeTempDb();
    try {
      raw.db.exec('DROP TRIGGER server_secret_no_delete');
      raw.db.run('DELETE FROM server_secret');
      expect(() => choiceOrderSecret(raw.db)).toThrow(ChoiceOrderSecretError);
    } finally {
      raw.cleanup();
    }
  });
});

describe('single-question choice quiz units: served order end to end', () => {
  let tmp: TempDb;
  beforeEach(() => {
    tmp = makeTempDb();
  });
  afterEach(() => tmp.cleanup());

  it('across many key-0 quiz units, always answering 0 passes about 1 in n, never all; the served key always passes; reveal points at the served key', async () => {
    const clock = fixedClock(localNoon(2026, 10, 1));
    const choices = ['alpha choice', 'bravo choice', 'charlie choice', 'delta choice'];
    const ids = Array.from({ length: 40 }, (_, i) =>
      insertUnit(tmp.db, { key: `zero:q${i}`, track: 'js', kind: 'quiz', title: `q${i}`, checks: [{ spec: { type: 'quiz', itemKey: `zero-${i}`, grading: 'choice', answerKey: 0, choices } }] }, clock),
    );
    const app = createApp({ db: tmp.db, clock, runners: {} });
    let zeroPasses = 0;
    for (const id of ids) {
      const d = UnitDetailResponse.parse((await request(app).get(`/api/units/${id}`)).body);
      const served = (d.check!.spec as { choices: string[] }).choices;
      expect([...served].sort()).toEqual([...choices].sort());
      expect(JSON.stringify(d)).not.toMatch(/answerKey/);
      // stable on re-fetch
      expect((UnitDetailResponse.parse((await request(app).get(`/api/units/${id}`)).body).check!.spec as { choices: string[] }).choices).toEqual(served);
      const z = SubmitResponse.parse((await request(app).post(`/api/units/${id}/submit`).send({ answer: 0 })).body);
      if (z.verdict === 'pass') zeroPasses++;
      const keyAt = served.indexOf('alpha choice');
      expect(z.verdict === 'pass').toBe(keyAt === 0);
      expect(SubmitResponse.parse((await request(app).post(`/api/units/${id}/submit`).send({ answer: keyAt })).body).verdict).toBe('pass');
      const rv = RevealResponse.parse((await request(app).post(`/api/units/${id}/reveal`).send({})).body);
      expect(rv.solution).toEqual({ kind: 'answer', answer: keyAt, choice: 'alpha choice' });
    }
    // expected 10 of 40; 28+ (70%) would mean the position bias leaked through
    expect(zeroPasses).toBeLessThan(28);
    expect(zeroPasses).toBeLessThan(ids.length);
  });
});
