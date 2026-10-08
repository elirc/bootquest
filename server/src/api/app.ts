import { readFileSync } from 'node:fs';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import {
  EmptyBody,
  EmptyQuery,
  GradeBody,
  ReviewItemParams,
  ReviewQueueQuery,
  SubmissionBody,
  TrackIdParams,
  UnitDetailResponse,
  UnitIdParams,
} from '@bootquest/shared/api';
import type { Db } from '../db/database.ts';
import { nowMs, type Clock } from '../engines/clock.ts';
import { dueCount } from '../engines/fsrs.ts';
import { contentCounts, reviewQueue } from '../store/queries.ts';
import { emptyContentStore, type UnitContentStore } from './content-store.ts';
import { asyncRoute, errorBody, HttpError, sendJson, validate } from './http.ts';
import { defaultRunners, type RunnerRegistry } from './runners.ts';
import {
  getDashboard,
  getRevealedSolution,
  getTrackUnits,
  getTracks,
  getUnitDetail,
  gradeReview,
  revealUnit,
  runUnit,
  submitUnit,
  type ServiceDeps,
} from './service.ts';

export const JSON_BODY_LIMIT = '256kb';
export const DEFAULT_QUEUE_LIMIT = 200;

const SERVER_VERSION: string = (
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }
).version;

export interface AppOptions {
  db: Db;
  /** injected clock — routes never read the wall clock */
  clock: Clock;
  /** runner registry keyed by check type (defaults: drill-js) */
  runners?: RunnerRegistry;
  /** seed-output content (starter + private reference solutions) */
  content?: UnitContentStore;
}

/**
 * Express app factory. Trust model: request bodies carry ONLY learner input
 * (code / answer) and the honor-system self-assist flag. XP, evidence,
 * verification, difficulty and assistance are always derived server-side
 * from recorded runs/attempts; there is no endpoint that writes XP or
 * evidence directly.
 */
export function createApp(opts: AppOptions): Express {
  const deps: ServiceDeps = {
    db: opts.db,
    clock: opts.clock,
    runners: opts.runners ?? defaultRunners(),
    content: opts.content ?? emptyContentStore,
  };
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  app.use(express.json({ limit: JSON_BODY_LIMIT, strict: true }));

  const router = express.Router();

  router.get('/health', asyncRoute((req, res) => {
    validate(EmptyQuery, req.query, 'query');
    sendJson(res, 200, { ok: true, version: SERVER_VERSION, counts: contentCounts(deps.db) });
  }));

  router.get('/dashboard', asyncRoute((req, res) => {
    validate(EmptyQuery, req.query, 'query');
    sendJson(res, 200, getDashboard(deps));
  }));

  router.get('/tracks', asyncRoute((req, res) => {
    validate(EmptyQuery, req.query, 'query');
    sendJson(res, 200, getTracks(deps));
  }));

  router.get('/tracks/:id/units', asyncRoute((req, res) => {
    const { id } = validate(TrackIdParams, req.params, 'params');
    validate(EmptyQuery, req.query, 'query');
    sendJson(res, 200, getTrackUnits(deps, id));
  }));

  router.get('/units/:id', asyncRoute((req, res) => {
    const { id } = validate(UnitIdParams, req.params, 'params');
    validate(EmptyQuery, req.query, 'query');
    // strict response parse: defense in depth against private-key leaks
    sendJson(res, 200, UnitDetailResponse.parse(getUnitDetail(deps, id)));
  }));

  router.post('/units/:id/run', asyncRoute(async (req, res) => {
    const { id } = validate(UnitIdParams, req.params, 'params');
    validate(EmptyQuery, req.query, 'query');
    const body = validate(SubmissionBody, req.body, 'body');
    const result = await runUnit(deps, id, { code: body.code, answer: body.answer });
    sendJson(res, 200, { result });
  }));

  router.post('/units/:id/submit', asyncRoute(async (req, res) => {
    const { id } = validate(UnitIdParams, req.params, 'params');
    validate(EmptyQuery, req.query, 'query');
    const body = validate(SubmissionBody, req.body, 'body');
    sendJson(res, 200, await submitUnit(deps, id, { code: body.code, answer: body.answer, selfAssisted: body.selfAssisted }));
  }));

  router.post('/units/:id/reveal', asyncRoute((req, res) => {
    const { id } = validate(UnitIdParams, req.params, 'params');
    validate(EmptyQuery, req.query, 'query');
    validate(EmptyBody, req.body, 'body');
    sendJson(res, 200, revealUnit(deps, id));
  }));

  router.get('/units/:id/solution', asyncRoute((req, res) => {
    const { id } = validate(UnitIdParams, req.params, 'params');
    validate(EmptyQuery, req.query, 'query');
    sendJson(res, 200, getRevealedSolution(deps, id));
  }));

  router.get('/reviews/queue', asyncRoute((req, res) => {
    const q = validate(ReviewQueueQuery, req.query, 'query');
    const items = reviewQueue(deps.db, nowMs(deps.clock), q.limit ?? DEFAULT_QUEUE_LIMIT);
    sendJson(res, 200, { count: dueCount(deps.db, deps.clock), items });
  }));

  router.post('/reviews/:itemId/grade', asyncRoute((req, res) => {
    const { itemId } = validate(ReviewItemParams, req.params, 'params');
    validate(EmptyQuery, req.query, 'query');
    const { grade } = validate(GradeBody, req.body, 'body');
    sendJson(res, 200, gradeReview(deps, itemId, grade));
  }));

  app.use('/api', router);

  // JSON 404 for everything else — never an HTML page
  app.use((req: Request, res: Response) => {
    sendJson(res, 404, errorBody('NOT_FOUND', `no route for ${req.method} ${req.path}`));
  });

  // JSON error handler (4-arity so Express treats it as one)
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      sendJson(res, err.status, errorBody(err.code, err.message, err.issues));
      return;
    }
    const e = err as { type?: string; status?: number; message?: string };
    if (e?.type === 'entity.too.large') {
      sendJson(res, 413, errorBody('PAYLOAD_TOO_LARGE', `request body exceeds ${JSON_BODY_LIMIT}`));
      return;
    }
    if (e?.type === 'entity.parse.failed') {
      sendJson(res, 400, errorBody('BAD_JSON', 'request body is not valid JSON'));
      return;
    }
    if (typeof e?.status === 'number' && e.status >= 400 && e.status < 500) {
      sendJson(res, e.status, errorBody('VALIDATION', e.message ?? 'bad request'));
      return;
    }
    console.error('[bootquest api] unhandled error:', err);
    sendJson(res, 500, errorBody('INTERNAL', 'internal server error'));
  });

  return app;
}
