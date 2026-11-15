/**
 * rv3 MF-10 (FABLE-REVIEW L9): a server test that installs no key-ideas store sees none. Before sideFilesDir
 * (store/keyideas.ts), keyIdeas() fell back to the repo's content/keyideas and resolved its 24 sections against
 * whatever units the test had loaded, printing "... matches no live unit" warnings. Outside vitest an unset
 * BOOTQUEST_KEYIDEAS still means the repo's content/ (checked with the variable and VITEST stubbed).
 */
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/api/app.ts';
import { fixedClock } from '../src/engines/clock.ts';
import { designSide, setDesignSide } from '../src/store/design-side.ts';
import { keyIdeas, setKeyIdeas, sideFilesDir } from '../src/store/keyideas.ts';
import { DEFAULT_CONTENT_DIR } from '../src/store/routing.ts';
import { localNoon, makeTempDb, makeUnit } from './helpers.ts';

describe('side-file isolation in the server suite', () => {
  afterEach(() => {
    setKeyIdeas(null);
    setDesignSide(null);
    vi.restoreAllMocks();
  });

  it('no installed store = no sections, no headlines, no design dimensions, and no key-idea warning on a subset estate', async () => {
    setKeyIdeas(null);
    setDesignSide(null);
    expect(keyIdeas().sections.size).toBe(0);
    expect(keyIdeas().headlines.size).toBe(0);
    expect(designSide()).toMatchObject({ loaded: false });
    expect(sideFilesDir()).toBeNull();
    // the app and the CLI (no VITEST): unset = the repo's content/; set = that dir; '' / 'off' = none
    const vitest = process.env.VITEST;
    try {
      delete process.env.VITEST;
      expect(sideFilesDir()).toBe(DEFAULT_CONTENT_DIR);
      vi.stubEnv('BOOTQUEST_KEYIDEAS', 'off');
      expect(sideFilesDir()).toBeNull();
      vi.stubEnv('BOOTQUEST_KEYIDEAS', 'Z:/some/content');
      expect(sideFilesDir()).toBe('Z:/some/content');
    } finally {
      process.env.VITEST = vitest;
      vi.unstubAllEnvs();
    }
    expect(sideFilesDir()).toBeNull();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tmp = makeTempDb();
    try {
      const clock = fixedClock(localNoon(2026, 11, 14));
      makeUnit(tmp.db, clock, { key: 'sysdrills/18-web-authz-and-sessions/01-only-one', kind: 'drill' });
      const app = createApp({ db: tmp.db, clock });
      expect((await request(app).get('/api/dashboard')).status).toBe(200);
      expect((await request(app).get('/api/reviews/queue')).status).toBe(200);
      expect((await request(app).get('/api/keyideas')).body).toEqual({ sections: [], tiles: [], recapsOpen: [], dueCards: 0 });
      expect(warn.mock.calls.filter((c) => String(c[0]).includes('keyideas:'))).toEqual([]);
    } finally {
      tmp.cleanup();
    }
  });
});
