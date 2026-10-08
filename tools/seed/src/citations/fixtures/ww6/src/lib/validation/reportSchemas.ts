/**
 * What this file does: Validates query parameters for report and trend endpoints.
 * What calls it: report, anomaly, and forecast routes under `src/app/api`.
 * What it calls: Zod.
 * Junior pitfall: Using freeform strings for month filters, causing inconsistent date parsing across endpoints.
 */
import { z } from "zod";

export const monthQuerySchema = z.object({
  // ⚠️ SENIOR NOTE: this strict datetime requirement avoids ambiguous month parsing across locales.
  monthStart: z.string().datetime()
});

export type MonthQueryInput = z.infer<typeof monthQuerySchema>;
