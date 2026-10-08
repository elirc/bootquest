/**
 * What this file does: Ingests validated cloud cost line items into tenant-scoped storage.
 * What calls it: `src/app/api/cost-line-items/route.ts`.
 * What it calls: `createManyCostLineItems` repository function.
 * Junior pitfall: Persisting unnormalized dates/currency fields, making reports inconsistent.
 */
import type { IngestCostPayload } from "@/lib/validation/costSchemas";
import { createManyCostLineItems } from "@/repositories/costLineItemRepository";
import { listCostLineItemsByMonth } from "@/repositories/costLineItemRepository";
import { toUtcMonthWindow } from "@/lib/time/month";

export async function ingestCostLineItems(tenantId: string, payload: IngestCostPayload) {
  // ⚠️ SENIOR NOTE: normalization here keeps ingestion idempotency/refeeds easier than spreading transforms in repositories.
  const rows = payload.lineItems.map((item) => ({
    tenantId,
    projectId: item.projectId,
    cloudProvider: item.cloudProvider,
    externalResourceId: item.externalResourceId,
    service: item.service,
    region: item.region,
    usageDate: new Date(item.usageDate),
    amount: item.amount,
    currency: item.currency,
    tags: item.tags,
    source: payload.source
  }));

  const result = await createManyCostLineItems(rows);

  return {
    insertedCount: result.count,
    source: payload.source
  };
}

export async function getCostLineItemsForMonth(
  tenantId: string,
  monthStartIso: string,
  pagination: { limit?: number; offset?: number }
) {
  const window = toUtcMonthWindow(monthStartIso);
  return listCostLineItemsByMonth(tenantId, window, pagination);
}
