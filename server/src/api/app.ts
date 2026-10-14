import { readFileSync } from 'node:fs';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import {
  AnswerRecordedResponse,
  AttemptDetailResponse,
  AttemptIdParams,
  CampaignResponse,
  CompetenciesResponse,
  EmptyBody,
  EvidenceListResponse,
  EvidenceQuery,
  ExplainBackAnswersBody,
  ExplainBackKeyResponse,
  ExplainBackScoreResponse,
  ExplainBackSelfScoreBody,
  KataFindingsBody,
  KataKeyResponse,
  KataScoreResponse,
  KataSelfScoreBody,
  KataStatsResponse,
  LadderResponse,
  MutationMarkerBody,
  MutationMarkerResponse,
  EmptyQuery,
  GradeBody,
  ReviewItemParams,
  ReviewQueueQuery,
  ReviewQueueResponse,
  SubmissionBody,
  SubmitResponse,
  TrackIdParams,
  UnitDetailResponse,
  UnitIdParams,
  UnitKeyParams,
  WrittenAnswerBody,
} from '@bootquest/shared/api';
import { RefContentResponse, RefIdParams, SeedQueueQuery, SeedQueueResponse, SyncRequestBody } from '@bootquest/shared/sync';
import type { Db } from '../db/database.ts';
import { seedQueue, SyncConfigError } from '../sync/job.ts';
import type { SyncService } from '../sync/service.ts';
import { nowMs, type Clock } from '../engines/clock.ts';
import { dueCount } from '../engines/fsrs.ts';
import { contentCounts, reviewQueue } from '../store/queries.ts';
import { emptyContentStore, type UnitContentStore } from './content-store.ts';
import { asyncRoute, errorBody, HttpError, sendJson, validate } from './http.ts';
import { getRefContent } from './service.ts';
import { reviewCardText } from './study-service.ts';
import { defaultRunners, type RunnerRegistry } from './runners.ts';
import { emptySeedItemStore, type SeedItemStore } from '../store/seed-items.ts';
import { ladderUnits } from '../store/ladder.ts';
import {
  answerExplainBack,
  getAttemptDetail,
  getCompetencies,
  getExplainBackKey,
  getKataKey,
  kataStats,
  listEvidence,
  recordMutationMarker,
  selfScoreExplainBack,
  selfScoreKata,
  submitKataFindings,
  type LadderDeps,
} from './ladder-service.ts';
import {
  answerWrittenUnit,
  getCampaign,
  getDashboard,
  getModelAnswer,
  getRevealedSolution,
  getTrackUnits,
  getTracks,
  getUnitDetail,
  getUnitDetailByKey,
  gradeReview,
  revealUnit,
  runUnit,
  selfAttestUnit,
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
  /** W4 GitHub sync + per-SHA caches (POST /sync, GET /refs/:id/content); absent = 501 SYNC_UNAVAILABLE */
  sync?: SyncService | null;
  /** W6 seed items: explain-back question sets + patch katas (absent = every such unit is content-pending) */
  seedItems?: SeedItemStore;
  /** W7: runs after every successful sync (serve.ts re-links ladder units: new program units become artifacts) */
  afterSync?: () => void;
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
    sync: opts.sync ?? null,
    seedItems: opts.seedItems ?? emptySeedItemStore,
  };
  const ladder: LadderDeps = { db: deps.db, clock: deps.clock, seedItems: deps.seedItems };
  let syncInFlight = false;
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

  // key = one URL-encoded path segment (keys contain '/'): /units/by-key/bootforge%2Fjs-fundamentals%2F...
  router.get('/units/by-key/:key', asyncRoute((req, res) => {
    const { key } = validate(UnitKeyParams, req.params, 'params');
    validate(EmptyQuery, req.query, 'query');
    sendJson(res, 200, UnitDetailResponse.parse(getUnitDetailByKey(deps, key)));
  }));

  router.get('/tracks/:id/campaign', asyncRoute((req, res) => {
    const { id } = validate(TrackIdParams, req.params, 'params');
    validate(EmptyQuery, req.query, 'query');
    sendJson(res, 200, CampaignResponse.parse(getCampaign(deps, id)));
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
    const result = await runUnit(deps, id, { code: body.code, answer: body.answer, answers: body.answers, port: body.port, repoPath: body.repoPath });
    sendJson(res, 200, { result });
  }));

  router.post('/units/:id/submit', asyncRoute(async (req, res) => {
    const { id } = validate(UnitIdParams, req.params, 'params');
    validate(EmptyQuery, req.query, 'query');
    const body = validate(SubmissionBody, req.body, 'body');
    sendJson(
      res,
      200,
      SubmitResponse.parse(
        await submitUnit(deps, id, { code: body.code, answer: body.answer, answers: body.answers, port: body.port, repoPath: body.repoPath, selfAssisted: body.selfAssisted }),
      ),
    );
  }));

  router.post('/units/:id/reveal', asyncRoute((req, res) => {
    const { id } = validate(UnitIdParams, req.params, 'params');
    validate(EmptyQuery, req.query, 'query');
    validate(EmptyBody, req.body, 'body');
    sendJson(res, 200, revealUnit(deps, id));
  }));

  router.post('/units/:id/self-attest', asyncRoute((req, res) => {
    const { id } = validate(UnitIdParams, req.params, 'params');
    validate(EmptyQuery, req.query, 'query');
    validate(EmptyBody, req.body, 'body');
    sendJson(res, 200, selfAttestUnit(deps, id));
  }));

  router.get('/units/:id/solution', asyncRoute((req, res) => {
    const { id } = validate(UnitIdParams, req.params, 'params');
    validate(EmptyQuery, req.query, 'query');
    sendJson(res, 200, getRevealedSolution(deps, id));
  }));

  // written units: answer first (stored immutably), THEN the model answer
  router.post('/units/:id/answer', asyncRoute((req, res) => {
    const { id } = validate(UnitIdParams, req.params, 'params');
    validate(EmptyQuery, req.query, 'query');
    const body = validate(WrittenAnswerBody, req.body, 'body');
    sendJson(res, 200, answerWrittenUnit(deps, id, body));
  }));

  router.get('/units/:id/model-answer', asyncRoute((req, res) => {
    const { id } = validate(UnitIdParams, req.params, 'params');
    validate(EmptyQuery, req.query, 'query');
    sendJson(res, 200, getModelAnswer(deps, id));
  }));

  // ---------------------------------------------------------------- W6 competency ladder
  // explain-back + patch kata: immutable answer FIRST (append-only attempt), THEN the key, THEN the self-score

  router.post('/units/:id/explain-back/answers', asyncRoute((req, res) => {
    const { id } = validate(UnitIdParams, req.params, 'params');
    validate(EmptyQuery, req.query, 'query');
    const body = validate(ExplainBackAnswersBody, req.body, 'body');
    sendJson(res, 200, AnswerRecordedResponse.parse(answerExplainBack(ladder, id, body)));
  }));

  router.get('/units/:id/explain-back/key', asyncRoute((req, res) => {
    const { id } = validate(UnitIdParams, req.params, 'params');
    validate(EmptyQuery, req.query, 'query');
    sendJson(res, 200, ExplainBackKeyResponse.parse(getExplainBackKey(ladder, id)));
  }));

  router.post('/units/:id/explain-back/self-score', asyncRoute((req, res) => {
    const { id } = validate(UnitIdParams, req.params, 'params');
    validate(EmptyQuery, req.query, 'query');
    const body = validate(ExplainBackSelfScoreBody, req.body, 'body');
    sendJson(res, 200, ExplainBackScoreResponse.parse(selfScoreExplainBack(ladder, id, body)));
  }));

  router.post('/units/:id/kata/findings', asyncRoute((req, res) => {
    const { id } = validate(UnitIdParams, req.params, 'params');
    validate(EmptyQuery, req.query, 'query');
    const body = validate(KataFindingsBody, req.body, 'body');
    sendJson(res, 200, AnswerRecordedResponse.parse(submitKataFindings(ladder, id, body)));
  }));

  router.get('/units/:id/kata/key', asyncRoute((req, res) => {
    const { id } = validate(UnitIdParams, req.params, 'params');
    validate(EmptyQuery, req.query, 'query');
    sendJson(res, 200, KataKeyResponse.parse(getKataKey(ladder, id)));
  }));

  router.post('/units/:id/kata/self-score', asyncRoute((req, res) => {
    const { id } = validate(UnitIdParams, req.params, 'params');
    validate(EmptyQuery, req.query, 'query');
    const body = validate(KataSelfScoreBody, req.body, 'body');
    sendJson(res, 200, KataScoreResponse.parse(selfScoreKata(ladder, id, body)));
  }));

  // `bootquest mutate`: the server re-evaluates the per-file floor + overall break from the counts
  router.post('/units/:id/mutation', asyncRoute((req, res) => {
    const { id } = validate(UnitIdParams, req.params, 'params');
    validate(EmptyQuery, req.query, 'query');
    const body = validate(MutationMarkerBody, req.body, 'body');
    sendJson(res, 200, MutationMarkerResponse.parse(recordMutationMarker(ladder, id, body)));
  }));

  router.get('/competencies', asyncRoute((req, res) => {
    validate(EmptyQuery, req.query, 'query');
    sendJson(res, 200, CompetenciesResponse.parse(getCompetencies(ladder)));
  }));

  router.get('/evidence', asyncRoute((req, res) => {
    const q = validate(EvidenceQuery, req.query, 'query');
    sendJson(res, 200, EvidenceListResponse.parse(listEvidence(ladder, q)));
  }));

  router.get('/attempts/:id', asyncRoute((req, res) => {
    const { id } = validate(AttemptIdParams, req.params, 'params');
    validate(EmptyQuery, req.query, 'query');
    sendJson(res, 200, AttemptDetailResponse.parse(getAttemptDetail(ladder, id)));
  }));

  router.get('/stats/katas', asyncRoute((req, res) => {
    validate(EmptyQuery, req.query, 'query');
    sendJson(res, 200, KataStatsResponse.parse(kataStats(ladder)));
  }));

  // W7: the ladder units (explain-back / G2 / kata bank / retests / authored G3-G4) with campaign links
  router.get('/ladder', asyncRoute((req, res) => {
    validate(EmptyQuery, req.query, 'query');
    const units = ladderUnits(deps.db);
    const n = (f: string) => units.filter((u) => u.family === f).length;
    sendJson(res, 200, LadderResponse.parse({ counts: { explainBack: n('explain-back'), g2: n('g2'), katas: n('kata'), retests: n('retest'), study: n('study'), authored: n('authored') }, units }));
  }));

  router.get('/reviews/queue', asyncRoute((req, res) => {
    const q = validate(ReviewQueueQuery, req.query, 'query');
    // W8: seeded cards (study-quest misses, flashcards) carry their text, resolved from the stamped pack
    const items = reviewQueue(deps.db, nowMs(deps.clock), q.limit ?? DEFAULT_QUEUE_LIMIT).map((it) => {
      const card = reviewCardText(deps.seedItems, it.cardKey);
      return card ? { ...it, card } : it;
    });
    sendJson(res, 200, ReviewQueueResponse.parse({ count: dueCount(deps.db, deps.clock), items }));
  }));

  router.post('/reviews/:itemId/grade', asyncRoute((req, res) => {
    const { itemId } = validate(ReviewItemParams, req.params, 'params');
    validate(EmptyQuery, req.query, 'query');
    const { grade } = validate(GradeBody, req.body, 'body');
    sendJson(res, 200, gradeReview(deps, itemId, grade));
  }));

  // ---------------------------------------------------------------- W4 GitHub sync

  // `bootquest sync` and (later) the UI: runs the sync job over curriculum.yaml
  router.post('/sync', asyncRoute(async (req, res) => {
    validate(EmptyQuery, req.query, 'query');
    const body = validate(SyncRequestBody, req.body ?? {}, 'body');
    if (!deps.sync) throw new HttpError(501, 'SYNC_UNAVAILABLE', 'this server has no GitHub sync configured');
    if (syncInFlight) throw new HttpError(409, 'SYNC_IN_PROGRESS', 'a sync is already running');
    syncInFlight = true;
    try {
      const report = await deps.sync.run(deps.db, deps.clock, body.repos ? { repos: body.repos } : {});
      opts.afterSync?.();
      sendJson(res, 200, report);
    } catch (err) {
      if (err instanceof SyncConfigError) throw new HttpError(400, 'VALIDATION', err.message, [{ path: 'body.repos', message: err.message }]);
      throw err;
    } finally {
      syncInFlight = false;
    }
  }));

  // the next seed session's work list: stable_keys first seen by a sync
  router.get('/sync/queue', asyncRoute((req, res) => {
    const q = validate(SeedQueueQuery, req.query, 'query');
    sendJson(res, 200, SeedQueueResponse.parse(seedQueue(deps.db, { status: q.status ?? 'pending', limit: q.limit ?? 500 })));
  }));

  // markdown of ONE registered ref, from the per-SHA cache (never the DB, never a request-supplied path)
  router.get('/refs/:id/content', asyncRoute(async (req, res) => {
    const { id } = validate(RefIdParams, req.params, 'params');
    validate(EmptyQuery, req.query, 'query');
    sendJson(res, 200, RefContentResponse.parse(await getRefContent(deps, id)));
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
