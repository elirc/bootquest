// BootQuest seed-time fixture solution for signalpost U03-02 (authored by BootQuest, NOT shipped upstream).
// Keeps the upstream public result contract; narrows `unknown` without `any` or unchecked `as`.
export type TaskResult =
  | { ok: true; task: { title: string; minutes: number } }
  | { ok: false; error: string };

export function parseTask(value: unknown): TaskResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "task must be a plain object" };
  }
  const title: unknown = Reflect.get(value, "title");
  const minutes: unknown = Reflect.get(value, "minutes");
  if (typeof title !== "string") return { ok: false, error: "title must be a string" };
  const trimmed = title.trim();
  if (trimmed.length === 0) return { ok: false, error: "title must not be blank" };
  if (trimmed.length > 80) return { ok: false, error: "title must be at most 80 characters" };
  if (typeof minutes !== "number" || !Number.isInteger(minutes)) {
    return { ok: false, error: "minutes must be an integer" };
  }
  if (minutes < 1 || minutes > 240) return { ok: false, error: "minutes must be between 1 and 240" };
  return { ok: true, task: { title: trimmed, minutes } };
}
