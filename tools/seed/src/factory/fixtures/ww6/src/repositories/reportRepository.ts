/**
 * What this file does: Provides reporting-specific read queries that combine allocation runs and results.
 * What calls it: `src/services/reportService.ts`.
 * What it calls: Prisma `allocationRun` and `allocationResult` aggregate/groupBy operations.
 * Junior pitfall: Running ad-hoc joins in route files, which duplicates financial query logic.
 */
import { db } from "@/lib/db";

export async function findLatestCompletedRunForMonth(tenantId: string, monthStart: Date) {
  return db.allocationRun.findFirst({
    where: {
      // Tenant filter is mandatory because run metadata is organization-private.
      tenantId,
      monthStart,
      status: "COMPLETED"
    },
    orderBy: [{ completedAt: "desc" }]
  });
}

export async function aggregateAllocationByTeam(tenantId: string, runId: string) {
  const grouped = await db.allocationResult.groupBy({
    by: ["allocatedTeamId"],
    where: {
      // Tenant boundary prevents cross-tenant cost attribution leakage.
      tenantId,
      runId
    },
    _sum: {
      allocatedAmount: true
    }
  });

  return grouped.map((row) => ({
    allocatedTeamId: row.allocatedTeamId,
    totalAllocated: Number(row._sum.allocatedAmount ?? 0)
  }));
}

export async function aggregateAllocationByProject(tenantId: string, runId: string) {
  const grouped = await db.allocationResult.groupBy({
    by: ["allocatedProjectId"],
    where: {
      // ?? SENIOR NOTE: leaving out tenantId here can produce quietly wrong chargeback exports.
      tenantId,
      runId
    },
    _sum: {
      allocatedAmount: true
    }
  });

  return grouped.map((row) => ({
    allocatedProjectId: row.allocatedProjectId,
    totalAllocated: Number(row._sum.allocatedAmount ?? 0)
  }));
}
