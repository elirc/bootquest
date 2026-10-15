// Fetch-backed implementation of BootQuestApi, bound to the real Express routes
// (server/src/api/app.ts). Route list = docs/recon/w1b-review.md binding worksheet.

import {
  ApiError,
  type AnswerRecordedResponse,
  type AttemptDetailResponse,
  type CampaignProgressResponse,
  type PassRatesResponse,
  type ReviewStatsResponse,
  type XpStatsResponse,
  type CampaignResponse,
  type CompetenciesResponse,
  type EvidenceListResponse,
  type ExplainBackKeyResponse,
  type ExplainBackScoreResponse,
  type KataKeyResponse,
  type KataScoreResponse,
  type KataStatsResponse,
  type ModelAnswerResponse,
  type BootQuestApi,
  type ClientErrorCode,
  type Dashboard,
  type GradeResponse,
  type HealthResponse,
  type ReviewQueueResponse,
  type RevealResponse,
  type RunResponse,
  type SelfAttestResponse,
  type SubmitResponse,
  type TrackUnitsResponse,
  type TracksResponse,
  type UnitDetail,
  type UnitNotesResponse,
  type RefContentResponse,
  type WrittenAnswerResponse,
} from './types';

type Init = { method: 'POST'; body: unknown };

/** Reads the `{error:{code,message,issues?}}` envelope; tolerates non-JSON bodies (proxies, crashes). */
async function toApiError(res: Response, path: string): Promise<ApiError> {
  const text = await res.text().catch(() => '');
  try {
    const parsed = JSON.parse(text) as { error?: { code?: unknown; message?: unknown; issues?: unknown } };
    const err = parsed.error;
    if (err && typeof err.code === 'string' && typeof err.message === 'string') {
      const issues = Array.isArray(err.issues) ? (err.issues as { path: string; message: string }[]) : undefined;
      return new ApiError(res.status, err.code as ClientErrorCode, err.message, issues);
    }
  } catch {
    // fall through: not JSON
  }
  return new ApiError(res.status, 'BAD_RESPONSE', `${res.status} ${path}${text ? `: ${text.slice(0, 200)}` : ''}`);
}

export function createHttpApi(baseUrl = '/api', fetchImpl: typeof fetch = (...a) => fetch(...a)): BootQuestApi {
  async function call<T>(path: string, init?: Init): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method: init?.method ?? 'GET',
        headers: init ? { 'content-type': 'application/json' } : undefined,
        body: init ? JSON.stringify(init.body) : undefined,
      });
    } catch (e) {
      throw new ApiError(0, 'NETWORK', e instanceof Error ? e.message : String(e));
    }
    if (!res.ok) throw await toApiError(res, path);
    try {
      return (await res.json()) as T;
    } catch {
      throw new ApiError(res.status, 'BAD_RESPONSE', `${path}: response was not JSON`);
    }
  }
  const post = <T>(path: string, body: unknown = {}) => call<T>(path, { method: 'POST', body });
  const unit = (id: number) => `/units/${encodeURIComponent(String(id))}`;

  return {
    getHealth: () => call<HealthResponse>('/health'),
    getDashboard: () => call<Dashboard>('/dashboard'),
    getTracks: () => call<TracksResponse>('/tracks'),
    getTrackUnits: (trackId) => call<TrackUnitsResponse>(`/tracks/${encodeURIComponent(trackId)}/units`),
    getUnit: (id) => call<UnitDetail>(unit(id)),
    runUnit: (id, input) =>
      post<RunResponse>(`${unit(id)}/run`, input.code !== undefined ? { code: input.code } : { answer: input.answer }),
    // Whitelisted body: only code|answer|answers + the boolean selfAssisted ever leave the client.
    submitUnit: (id, s) =>
      post<SubmitResponse>(
        `${unit(id)}/submit`,
        s.code !== undefined
          ? { code: s.code, selfAssisted: s.selfAssisted }
          : s.answers !== undefined
            ? { answers: s.answers, selfAssisted: s.selfAssisted }
            : { answer: s.answer, selfAssisted: s.selfAssisted },
      ),
    revealUnit: (id) => post<RevealResponse>(`${unit(id)}/reveal`),
    getSolution: (id) => call<RevealResponse>(`${unit(id)}/solution`),
    selfAttest: (id) => post<SelfAttestResponse>(`${unit(id)}/self-attest`),
    // Whitelisted body: only the learner's own answer text + the boolean selfAssisted.
    answerWritten: (id, b) => post<WrittenAnswerResponse>(`${unit(id)}/answer`, { answer: b.answer, selfAssisted: b.selfAssisted }),
    getModelAnswer: (id) => call<ModelAnswerResponse>(`${unit(id)}/model-answer`),
    getReviewQueue: (limit) => call<ReviewQueueResponse>(`/reviews/queue${limit !== undefined ? `?limit=${limit}` : ''}`),
    gradeReview: (itemId, grade) => post<GradeResponse>(`/reviews/${encodeURIComponent(String(itemId))}/grade`, { grade }),
    getCampaign: (trackId) => call<CampaignResponse>(`/tracks/${encodeURIComponent(trackId)}/campaign`),
    // Whitelisted bodies: only the learner's own answer + the boolean selfAssisted ever leave the client.
    answerExplainBack: (id, b) => post<AnswerRecordedResponse>(`${unit(id)}/explain-back/answers`, { answers: b.answers, selfAssisted: b.selfAssisted }),
    getExplainBackKey: (id) => call<ExplainBackKeyResponse>(`${unit(id)}/explain-back/key`),
    selfScoreExplainBack: (id, b) => post<ExplainBackScoreResponse>(`${unit(id)}/explain-back/self-score`, { perKeyPoint: b.perKeyPoint }),
    submitKataFindings: (id, b) =>
      post<AnswerRecordedResponse>(`${unit(id)}/kata/findings`, {
        findings: b.findings.map((f) => ({ scenario: f.scenario, evidence: f.evidence, consequence: f.consequence })),
        selfAssisted: b.selfAssisted,
      }),
    getKataKey: (id) => call<KataKeyResponse>(`${unit(id)}/kata/key`),
    selfScoreKata: (id, b) => post<KataScoreResponse>(`${unit(id)}/kata/self-score`, { perDefect: b.perDefect }),
    getCompetencies: () => call<CompetenciesResponse>('/competencies'),
    listEvidence: (q = {}) => {
      const params = new URLSearchParams();
      if (q.competency) params.set('competency', q.competency);
      if (q.kind) params.set('kind', q.kind);
      if (q.limit !== undefined) params.set('limit', String(q.limit));
      const qs = params.toString();
      return call<EvidenceListResponse>(`/evidence${qs ? `?${qs}` : ''}`);
    },
    getAttempt: (id) => call<AttemptDetailResponse>(`/attempts/${encodeURIComponent(String(id))}`),
    getKataStats: () => call<KataStatsResponse>('/stats/katas'),
    getXpStats: () => call<XpStatsResponse>('/stats/xp'),
    getPassRates: () => call<PassRatesResponse>('/stats/pass-rates'),
    getReviewStats: () => call<ReviewStatsResponse>('/stats/reviews'),
    getCampaignProgress: () => call<CampaignProgressResponse>('/stats/campaign'),
    getUnitNotes: (id) => call<UnitNotesResponse>(`${unit(id)}/notes`),
    getRefContent: (refId) => call<RefContentResponse>(`/refs/${encodeURIComponent(String(refId))}/content`),
  };
}
