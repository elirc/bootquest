/**
 * What this file does: provides a tiny demo session directory so routes and UI can exercise auth without a full identity provider.
 * What calls it: src/lib/auth/session.ts and client fetch utilities that send demo headers.
 * What it calls: shared session types in src/lib/domain.ts.
 * One thing a junior engineer would likely get wrong when writing something similar: letting demo auth leak into business logic instead of keeping it in a replaceable adapter.
 */
import type { AppSession } from "@/lib/domain";

export const DEMO_HEADER_USER = "x-demo-user-id";
export const DEMO_HEADER_TENANT = "x-demo-tenant-id";
export const DEMO_SESSION_STORAGE_KEY = "hr-control-center-demo-session";

export const DEFAULT_DEMO_SESSION: AppSession = {
  userId: "user_hr_admin",
  activeTenantId: "tenant_northstar",
  platformRole: "NONE",
  tenantRole: "HR_ADMIN",
  employeeId: "emp_alex",
  displayName: "Alex HR",
};

export const demoSessions: Record<string, AppSession> = {
  user_platform_admin: {
    userId: "user_platform_admin",
    activeTenantId: "tenant_northstar",
    platformRole: "PLATFORM_ADMIN",
    tenantRole: "TENANT_ADMIN",
    displayName: "Platform Admin",
  },
  user_hr_admin: DEFAULT_DEMO_SESSION,
  user_manager: {
    userId: "user_manager",
    activeTenantId: "tenant_northstar",
    platformRole: "NONE",
    tenantRole: "MANAGER",
    employeeId: "emp_morgan",
    displayName: "Morgan Manager",
  },
  user_employee: {
    userId: "user_employee",
    activeTenantId: "tenant_northstar",
    platformRole: "NONE",
    tenantRole: "EMPLOYEE",
    employeeId: "emp_sam",
    displayName: "Sam Employee",
  },
  user_integration_admin: {
    userId: "user_integration_admin",
    activeTenantId: "tenant_northstar",
    platformRole: "NONE",
    tenantRole: "INTEGRATION_ADMIN",
    employeeId: "emp_ivy",
    displayName: "Ivy Integrations",
  },
};

export const demoSessionOptions = Object.entries(demoSessions).map(
  ([sessionId, session]) => ({
    sessionId,
    label: `${session.displayName} (${session.tenantRole})`,
    session,
  }),
);
