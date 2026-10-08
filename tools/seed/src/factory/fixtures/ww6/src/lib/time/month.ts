/**
 * What this file does: Normalizes month windows for reporting and allocation calculations.
 * What calls it: API routes and services that need deterministic month boundaries.
 * What it calls: Native `Date` operations.
 * Junior pitfall: Using local timezone month math, which shifts boundaries and corrupts finance reporting.
 */
import { ValidationError } from "@/lib/http/errors";
import type { MonthWindow } from "@/types/domain";

export function toUtcMonthWindow(monthIsoDate: string): MonthWindow {
  const parsed = new Date(monthIsoDate);

  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError("month must be a valid ISO date, e.g. 2026-03-01");
  }

  const monthStart = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, 1));

  // ⚠️ SENIOR NOTE: UTC boundaries avoid DST/local-time drift that can shift spend into wrong reporting months.
  return { monthStart, monthEnd };
}
