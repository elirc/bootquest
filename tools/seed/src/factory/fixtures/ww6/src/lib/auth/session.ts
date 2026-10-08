/**
 * What this file does: Resolves session context from request headers for API auth.
 * What calls it: `src/lib/middleware/withAuth.ts`.
 * What it calls: `findUserById` in `src/repositories/userRepository.ts` and HTTP error utilities.
 * Junior pitfall: Trusting client-provided role/tenant headers directly instead of loading authoritative user records.
 */
import type { NextRequest } from "next/server";
import { UnauthorizedError } from "@/lib/http/errors";
import { findUserById } from "@/repositories/userRepository";
import type { AuthContext } from "@/types/domain";

export async function requireSession(request: NextRequest): Promise<AuthContext> {
  const userId = request.headers.get("x-user-id");

  if (!userId) {
    throw new UnauthorizedError("Missing x-user-id header");
  }

  const user = await findUserById(userId);
  if (!user) {
    throw new UnauthorizedError("Invalid user session");
  }

  // ?? SENIOR NOTE: we derive tenantId/role from DB, not headers, to avoid privilege escalation via spoofed request metadata.
  return {
    userId: user.id,
    tenantId: user.tenantId,
    role: user.role,
    email: user.email,
    name: user.name
  };
}
