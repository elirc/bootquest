/**
 * ab wave API extensions. NOT fingerprinted: `index.ts`, `pack.ts` and every seed generator must never
 * import this module (checked by `npm run restamp:all -- --dry-run` showing 0 stale stamps and by
 * `tools/seed/src/factory/fingerprint.test.ts` passing unchanged). `api.ts` stays byte-identical; new
 * endpoints get new schemas here, and an existing strict response that gains a field is re-declared here
 * with `.extend()`, then the server parses and the client types against the extended schema.
 *
 * One section per stream. Append inside your own section only; the hub resolves merges.
 */
import { z } from 'zod';
import * as api from './api.ts';

void z;
void api;

// ---- S1 slate + first run -------------------------------------------------------------------------

// ---- S2 truth layer (review cards, demotion) --------------------------------------------------------

// ---- S3 weak spots + due now --------------------------------------------------------------------------

// ---- S4 find things (search, dashboard targets, mixed drills) -----------------------------------------

// ---- S5 explain-back weights + score detail -------------------------------------------------------------
