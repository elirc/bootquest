/**
 * What this file does: defines the minimal tenant-aware repository context derived from the authenticated session.
 * What calls it: service-layer modules before they call repositories.
 * What it calls: session types from src/lib/domain.ts.
 * One thing a junior engineer would likely get wrong when writing something similar: passing the whole request object into repositories and letting low-level data access depend on HTTP details.
 */
import type { AppSession } from "@/lib/domain";

export interface RepositoryContext {
  tenantId: string;
  actorUserId: string;
}

export function toRepositoryContext(session: AppSession): RepositoryContext {
  return {
    tenantId: session.activeTenantId,
    actorUserId: session.userId,
  };
}
