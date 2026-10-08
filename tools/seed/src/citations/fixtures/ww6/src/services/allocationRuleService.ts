/**
 * What this file does: Creates and lists allocation rules with business-level constraints.
 * What calls it: `src/app/api/allocation-rules/route.ts`.
 * What it calls: allocation rule repository.
 * Junior pitfall: Skipping service-layer checks and inserting logically invalid rules directly from routes.
 */
import { ValidationError } from "@/lib/http/errors";
import type { CreateAllocationRuleInput } from "@/lib/validation/allocationSchemas";
import {
  createAllocationRule,
  listAllocationRules
} from "@/repositories/allocationRuleRepository";

export async function createRule(tenantId: string, input: CreateAllocationRuleInput) {
  // ⚠️ SENIOR NOTE: duplicating this invariant with schema-level checks protects against non-HTTP callers too.
  if (!input.targetProjectId && !input.targetTeamId) {
    throw new ValidationError("Rule must target a team or project");
  }

  return createAllocationRule({
    tenantId,
    name: input.name,
    matchTagKey: input.matchTagKey,
    matchTagValue: input.matchTagValue,
    weightPercent: input.weightPercent,
    targetTeamId: input.targetTeamId,
    targetProjectId: input.targetProjectId
  });
}

export async function listRules(tenantId: string) {
  return listAllocationRules(tenantId);
}
