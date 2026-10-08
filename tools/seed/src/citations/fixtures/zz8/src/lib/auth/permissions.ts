/**
 * What this file does: centralizes platform and tenant authorization checks so permission rules stay reviewable.
 * What calls it: service-layer functions before business logic runs.
 * What it calls: AppError in src/lib/http/app-error.ts and session types in src/lib/domain.ts.
 * One thing a junior engineer would likely get wrong when writing something similar: checking roles inside React components and leaving API paths under-protected.
 */
import type { AppSession, PlatformRole, TenantRole } from "@/lib/domain";
import { AppError } from "@/lib/http/app-error";

export function assertTenantRole(
  session: AppSession,
  allowedRoles: TenantRole[],
  action: string,
) {
  if (
    session.platformRole !== "PLATFORM_ADMIN" &&
    !allowedRoles.includes(session.tenantRole)
  ) {
    throw new AppError(
      403,
      `The ${session.tenantRole} role cannot ${action}.`,
    );
  }
}

export function assertPlatformRole(
  session: AppSession,
  allowedRoles: PlatformRole[],
  action: string,
) {
  if (!allowedRoles.includes(session.platformRole)) {
    throw new AppError(403, `The caller cannot ${action}.`);
  }
}

export function assertEmployeeContext(session: AppSession) {
  if (!session.employeeId) {
    throw new AppError(403, "This action requires an employee-linked tenant membership.");
  }
}
