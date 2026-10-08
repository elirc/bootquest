/**
 * What this file does: Validates allocation rule creation and allocation run requests.
 * What calls it: `src/app/api/allocation-rules/route.ts` and `src/app/api/allocation-runs/route.ts`.
 * What it calls: Zod.
 * Junior pitfall: Accepting rule weights >100 or <=0, which creates impossible allocation math.
 */
import { z } from "zod";

export const createAllocationRuleSchema = z
  .object({
    name: z.string().min(3).max(120),
    matchTagKey: z.string().min(1),
    matchTagValue: z.string().min(1),
    weightPercent: z.number().gt(0).lte(100),
    targetTeamId: z.string().optional(),
    targetProjectId: z.string().optional(),
    isActive: z.boolean().optional().default(true)
  })
  .refine(
    (value) => Boolean(value.targetTeamId || value.targetProjectId),
    // ⚠️ SENIOR NOTE: orphan rules break chargeback attribution silently, so we fail fast at validation.
    "Either targetTeamId or targetProjectId is required"
  );

export const createAllocationRunSchema = z.object({
  monthStart: z.string().datetime()
});

export type CreateAllocationRuleInput = z.infer<typeof createAllocationRuleSchema>;
export type CreateAllocationRunInput = z.infer<typeof createAllocationRunSchema>;
