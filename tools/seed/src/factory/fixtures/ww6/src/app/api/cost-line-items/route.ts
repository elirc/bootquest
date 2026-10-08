/**
 * What this file does: Ingests cloud cost line items and lists monthly line items.
 * What calls it: Dashboard UI hooks under `src/hooks`.
 * What it calls: `withRole`, Zod schemas, and `ingestionService`.
 * Junior pitfall: Parsing request body directly into DB calls without schema validation.
 */
import { NextResponse } from "next/server";
import { withRole } from "@/lib/middleware/withRole";
import { ingestCostPayloadSchema } from "@/lib/validation/costSchemas";
import { ingestCostLineItems, getCostLineItemsForMonth } from "@/services/ingestionService";

function currentMonthStartIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export const POST = withRole("ingestCosts", async (request, auth) => {
  // ⚠️ SENIOR NOTE: validation happens before service call so malformed vendor exports never hit persistence.
  const payload = ingestCostPayloadSchema.parse(await request.json());
  const result = await ingestCostLineItems(auth.tenantId, payload);

  return NextResponse.json(result, { status: 201 });
});

export const GET = withRole("readReports", async (request, auth) => {
  const monthStart = request.nextUrl.searchParams.get("monthStart") ?? currentMonthStartIso();
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? "100");
  const offset = Number(request.nextUrl.searchParams.get("offset") ?? "0");

  const result = await getCostLineItemsForMonth(auth.tenantId, monthStart, {
    limit,
    offset
  });

  return NextResponse.json({ items: result });
});
