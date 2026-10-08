// U03-02. Replace the unfinished behavior; retain this public result contract.
export type TaskResult =
  | { ok: true; task: { title: string; minutes: number } }
  | { ok: false; error: string };

export function parseTask(value: unknown): TaskResult {
  throw new Error("U03 learner implementation required");
}
