import type { Db } from '../src/db/database.ts';
import { DRILL_SET_SIZE } from '../src/engines/streak.ts';
import { fixedClock } from '../src/engines/clock.ts';
import { addReviewItem } from '../src/engines/fsrs.ts';
import { localNoon } from './helpers.ts';

/**
 * ab wave A1 test fixtures. The unconfigured slate asks for 1 drill per track and hides the review
 * slot until a card existed before the day started. Suites written against the pre-ab slate (5 drills
 * per track, review slot always shown) opt back into that shape here, through the same ledger the
 * learner uses: slate_setting rows (the `full` preset) effective long before the test clock, and one
 * review card on file since then that is not due for decades (so it never enters the queue).
 */
export const FIXTURE_EPOCH_DAY = '2000-01-01';

/** The `full` preset (5 drills per track) for every track, effective since 2000-01-01. */
export function fullSlateSetting(db: Db): void {
  for (const { id } of db.all<{ id: string }>('SELECT id FROM track')) {
    db.run(
      'INSERT INTO slate_setting (track_id, enabled, size, effective_day, created_at) VALUES (?, 1, ?, ?, ?)',
      id,
      DRILL_SET_SIZE,
      FIXTURE_EPOCH_DAY,
      localNoon(2000, 1, 1).getTime(),
    );
  }
}

/** A review card created 2000-01-01, due in 2100: the review slot is shown, the queue stays empty. */
export function cardOnFile(db: Db): void {
  addReviewItem(db, { cardKey: 'fixture:card-on-file', dueAt: localNoon(2100, 1, 1).getTime() }, fixedClock(localNoon(2000, 1, 1)));
}

/** The pre-ab slate shape: 5 drills per slate track + the review slot. */
export function legacySlate(db: Db): void {
  fullSlateSetting(db);
  cardOnFile(db);
}
