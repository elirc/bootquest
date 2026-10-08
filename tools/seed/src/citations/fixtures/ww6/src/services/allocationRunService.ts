/**
 * What this file does: Manages allocation run lifecycle, state transitions, and async execution orchestration.
 * What calls it: `src/app/api/allocation-runs/route.ts` and queue worker registration.
 * What it calls: allocation repositories, engine service, and queue utility.
 * Junior pitfall: Treating run status as free-form updates rather than a constrained state machine.
 */
import type { AllocationRunStatus } from "@prisma/client";
import { NotFoundError, ValidationError } from "@/lib/http/errors";
import { enqueueAllocationRun, registerAllocationWorker } from "@/lib/queue/allocationQueue";
import {
  createAllocationRun,
  getAllocationRunById,
  listAllocationRuns,
  replaceAllocationResults,
  updateAllocationRunStatus
} from "@/repositories/allocationRunRepository";
import { computeAllocationResults } from "@/services/allocationEngineService";
import type { AuthContext, RunTransitionInput } from "@/types/domain";

const VALID_RUN_TRANSITIONS: Record<AllocationRunStatus, AllocationRunStatus[]> = {
  PENDING: ["RUNNING", "FAILED"],
  RUNNING: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  FAILED: []
};

export function assertValidRunTransition(input: RunTransitionInput) {
  const allowedNext = VALID_RUN_TRANSITIONS[input.from];

  if (!allowedNext.includes(input.to)) {
    throw new ValidationError(`Invalid run transition: ${input.from} -> ${input.to}`);
  }
}

async function transitionRunStatus(
  tenantId: string,
  runId: string,
  nextStatus: AllocationRunStatus,
  extra: Partial<{ startedAt: Date; completedAt: Date; failureReason: string; summaryJson: Record<string, unknown> }> = {}
) {
  const run = await getAllocationRunById(tenantId, runId);

  if (!run) {
    throw new NotFoundError("Allocation run not found");
  }

  assertValidRunTransition({
    from: run.status,
    to: nextStatus
  });

  await updateAllocationRunStatus({
    tenantId,
    runId,
    status: nextStatus,
    startedAt: extra.startedAt,
    completedAt: extra.completedAt,
    failureReason: extra.failureReason,
    summaryJson: extra.summaryJson
  });
}

export async function createRunAndQueue(auth: AuthContext, monthStartIso: string) {
  const run = await createAllocationRun({
    tenantId: auth.tenantId,
    monthStart: new Date(monthStartIso),
    initiatedByUserId: auth.userId
  });

  // Queueing keeps API latency low while preserving an auditable run record.
  enqueueAllocationRun({
    tenantId: auth.tenantId,
    runId: run.id,
    monthStartIso
  });

  return run;
}

export async function listRuns(tenantId: string) {
  return listAllocationRuns(tenantId);
}

export async function processQueuedAllocationRun(job: {
  tenantId: string;
  runId: string;
  monthStartIso: string;
}) {
  try {
    await transitionRunStatus(job.tenantId, job.runId, "RUNNING", {
      startedAt: new Date()
    });

    const computation = await computeAllocationResults(job.tenantId, job.runId, job.monthStartIso);

    await replaceAllocationResults(job.tenantId, job.runId, computation.results);

    await transitionRunStatus(job.tenantId, job.runId, "COMPLETED", {
      completedAt: new Date(),
      summaryJson: computation.summary
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown run failure";

    // ?? SENIOR NOTE: failed runs must still transition to terminal state, otherwise ops dashboards show stuck work forever.
    await updateAllocationRunStatus({
      tenantId: job.tenantId,
      runId: job.runId,
      status: "FAILED",
      completedAt: new Date(),
      failureReason: message
    });
  }
}

registerAllocationWorker(processQueuedAllocationRun);
