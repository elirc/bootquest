// Fetch-backed implementation of BootQuestApi, bound to the real Express routes
// (server/src/api/app.ts). Route list = docs/recon/w1b-review.md binding worksheet.

import {
  ApiError,
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
    // Whitelisted body: only code|answer + the boolean selfAssisted ever leave the client.
    submitUnit: (id, s) =>
      post<SubmitResponse>(
        `${unit(id)}/submit`,
        s.code !== undefined ? { code: s.code, selfAssisted: s.selfAssisted } : { answer: s.answer, selfAssisted: s.selfAssisted },
      ),
    revealUnit: (id) => post<RevealResponse>(`${unit(id)}/reveal`),
    getSolution: (id) => call<RevealResponse>(`${unit(id)}/solution`),
    selfAttest: (id) => post<SelfAttestResponse>(`${unit(id)}/self-attest`),
    getReviewQueue: (limit) => call<ReviewQueueResponse>(`/reviews/queue${limit !== undefined ? `?limit=${limit}` : ''}`),
    gradeReview: (itemId, grade) => post<GradeResponse>(`/reviews/${encodeURIComponent(String(itemId))}/grade`, { grade }),
  };
}
