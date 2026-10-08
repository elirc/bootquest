/**
 * What this file does: Lightweight in-process queue for running allocation jobs asynchronously.
 * What calls it: `src/services/allocationRunService.ts` (register + enqueue).
 * What it calls: Registered worker callback.
 * Junior pitfall: Running heavy allocation work inline in request handlers and causing API timeouts.
 */
type AllocationRunJob = {
  tenantId: string;
  runId: string;
  monthStartIso: string;
};

let worker: ((job: AllocationRunJob) => Promise<void>) | null = null;

export function registerAllocationWorker(handler: (job: AllocationRunJob) => Promise<void>) {
  worker = handler;
}

export function enqueueAllocationRun(job: AllocationRunJob) {
  // In production, replace with durable queue (SQS/BullMQ). In-process queue is intentional learning placeholder.
  setTimeout(async () => {
    if (!worker) {
      return;
    }

    // ?? SENIOR NOTE: process crashes lose in-memory jobs; this is acceptable only for mock/local environments.
    await worker(job);
  }, 5);
}
