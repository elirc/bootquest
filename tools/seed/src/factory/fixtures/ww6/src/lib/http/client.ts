/**
 * What this file does: Shared API client helpers for authenticated frontend fetches.
 * What calls it: React Query hooks in `src/hooks/*`.
 * What it calls: Browser `fetch`.
 * Junior pitfall: Forgetting auth headers in one hook and debugging inconsistent 401s.
 */
const DEMO_USER_ID = process.env.NEXT_PUBLIC_DEMO_USER_ID ?? "replace_with_seed_user_id";

type FetchOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  query?: Record<string, string | undefined>;
};

export async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const url = new URL(path, window.location.origin);

  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value) {
        url.searchParams.set(key, value);
      }
    }
  }

  const response = await fetch(url.toString(), {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      // ⚠️ SENIOR NOTE: this placeholder header simulates session auth; production code should use signed cookies/JWT middleware.
      "x-user-id": DEMO_USER_ID
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.error?.message ?? "Request failed");
  }

  return payload;
}
