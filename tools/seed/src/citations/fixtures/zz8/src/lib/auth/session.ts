/**
 * What this file does: resolves the acting session for API requests from demo headers and guarantees an authenticated caller exists.
 * What calls it: src/lib/http/route-context.ts and route handlers that need a session.
 * What it calls: the demo auth directory in src/lib/demo/demo-sessions.ts and AppError in src/lib/http/app-error.ts.
 * One thing a junior engineer would likely get wrong when writing something similar: scattering raw header parsing across routes instead of centralizing it once.
 */
import type { AppSession } from "@/lib/domain";
import {
  DEFAULT_DEMO_SESSION,
  DEMO_HEADER_TENANT,
  DEMO_HEADER_USER,
  demoSessions,
} from "@/lib/demo/demo-sessions";
import { AppError } from "@/lib/http/app-error";

export function resolveSession(request: Request): AppSession {
  const userId = request.headers.get(DEMO_HEADER_USER) ?? DEFAULT_DEMO_SESSION.userId;
  const tenantId =
    request.headers.get(DEMO_HEADER_TENANT) ?? DEFAULT_DEMO_SESSION.activeTenantId;
  const session = demoSessions[userId];

  if (!session) {
    throw new AppError(401, "Unknown demo session.");
  }

  if (session.platformRole !== "PLATFORM_ADMIN" && session.activeTenantId !== tenantId) {
    throw new AppError(403, "Requested tenant does not match the authenticated membership.");
  }

  return {
    ...session,
    activeTenantId: tenantId,
  };
}

export function requireSession(request: Request) {
  const session = resolveSession(request);

  if (!session.userId) {
    throw new AppError(401, "Authentication required.");
  }

  return session;
}
