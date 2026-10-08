/**
 * What this file does: Handles allocation run state and allocation result persistence.
 * What calls it: `src/services/allocationRunService.ts`.
 * What it calls: Prisma `allocationRun` and `allocationResult` APIs.
 * Junior pitfall: Updating run status without validating allowed transitions, causing inconsistent audit trails.
 */
import { db } from "@/lib/db";
import type { AllocationRunStatus } from "@prisma/client";

type CreateRunInput = {
  tenantId: string;
  monthStart: Date;
  initiatedByUserId: string;
};

type UpdateRunStatusInput = {
  tenantId: string;
  runId: string;
  status: AllocationRunStatus;
  startedAt?: Date;
  completedAt?: Date;
  failureReason?: string;
  summaryJson?: Record<string, unknown>;
};

type CreateAllocationResultInput = {
  tenantId: string;
  runId: string;
  costLineItemId: string;
  allocatedTeamId?: string;
  allocatedProjectId?: string;
  allocationPercent: number;
  allocatedAmount: number;
};

export async function createAllocationRun(input: CreateRunInput) {
  return db.allocationRun.create({
    data: {
      ...input,
      status: "PENDING"
    }
  });
}

export async function listAllocationRuns(tenantId: string, limit = 20) {
  return db.allocationRun.findMany({
    where: {
      // Tenant scoping prevents run metadata visibility across organizations.
      tenantId
    },
    orderBy: [{ createdAt: "desc" }],
    take: limit
  });
}

export async function getAllocationRunById(tenantId: string, runId: string) {
  return db.allocationRun.findFirst({
    where: {
      // ?? SENIOR NOTE: `findUnique({ where: { id: runId } })` is not enough for multi-tenancy; tenantId must be in the lookup path.
      id: runId,
      tenantId
    }
  });
}

export async function updateAllocationRunStatus(input: UpdateRunStatusInput) {
  return db.allocationRun.updateMany({
    where: {
      // UpdateMany with tenantId ensures the write cannot mutate another tenant's run by id collision assumptions.
      id: input.runId,
      tenantId: input.tenantId
    },
    data: {
      status: input.status,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      failureReason: input.failureReason,
      summaryJson: input.summaryJson
    }
  });
}

export async function replaceAllocationResults(
  tenantId: string,
  runId: string,
  results: CreateAllocationResultInput[]
) {
  await db.$transaction(async (tx) => {
    await tx.allocationResult.deleteMany({
      where: {
        // Clear only this tenant + run scope so retries stay isolated.
        tenantId,
        runId
      }
    });

    if (results.length > 0) {
      await tx.allocationResult.createMany({
        data: results
      });
    }
  });
}

export async function listAllocationResultsByRun(tenantId: string, runId: string) {
  return db.allocationResult.findMany({
    where: {
      // Tenant filter is mandatory because results are the basis of chargeback invoices.
      tenantId,
      runId
    },
    include: {
      team: true,
      project: true,
      costItem: true
    }
  });
}
