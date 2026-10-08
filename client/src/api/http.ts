// Proposed fetch-backed implementation of BootQuestApi — the W1b contract.
// Not exercised by the P5 prototype (the mock is selected in ./client.ts); W1b
// owns the final route names and must keep the response shapes in ./types.ts.

import {
  ApiNotFoundError,
  type BootQuestApi,
  type Campaign,
  type Dashboard,
  type Exercise,
  type QuizAnswerResult,
  type ReviewCard,
  type ReviewGradeResult,
  type ReviewQueueCount,
  type RunResult,
  type SubmitResult,
  type Track,
} from './types';

export class ApiHttpError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    body: string,
  ) {
    super(`${status} ${path}: ${body.slice(0, 200)}`);
    this.name = 'ApiHttpError';
  }
}

export function createHttpApi(baseUrl = '/api', fetchImpl: typeof fetch = fetch): BootQuestApi {
  async function call<T>(path: string, init?: { method: 'POST'; body: unknown }): Promise<T> {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      method: init?.method ?? 'GET',
      headers: init ? { 'content-type': 'application/json' } : undefined,
      body: init ? JSON.stringify(init.body) : undefined,
    });
    if (res.status === 404) throw new ApiNotFoundError(path);
    if (!res.ok) throw new ApiHttpError(res.status, path, await res.text());
    return (await res.json()) as T;
  }
  const enc = encodeURIComponent;

  return {
    getDashboard: () => call<Dashboard>('/dashboard'),
    getTracks: () => call<Track[]>('/tracks'),
    getCampaign: (trackId) => call<Campaign>(`/tracks/${enc(trackId)}/campaign`),
    getExercise: (unitId) => call<Exercise>(`/units/${enc(unitId)}`),
    runExercise: (unitId, code) => call<RunResult>(`/units/${enc(unitId)}/run`, { method: 'POST', body: { code } }),
    submitAttempt: (unitId, code, assistance) =>
      call<SubmitResult>(`/units/${enc(unitId)}/attempts`, { method: 'POST', body: { code, assistance } }),
    submitQuizAnswer: (unitId, choiceIndex) =>
      call<QuizAnswerResult>(`/units/${enc(unitId)}/quiz-answer`, { method: 'POST', body: { choiceIndex } }),
    getReviewQueueCount: () => call<ReviewQueueCount>('/review/count'),
    getReviewQueue: () => call<ReviewCard[]>('/review/queue'),
    gradeReview: (cardId, grade) =>
      call<ReviewGradeResult>(`/review/${enc(cardId)}/grade`, { method: 'POST', body: { grade } }),
  };
}
