/**
 * What this file does: owns integration dashboard reads, job queueing, retry authorization, and worker triggering.
 * What calls it: integration route handlers under src/app/api/integration-jobs/ and src/app/api/integration-configs/.
 * What it calls: auth guards, repository context helpers, integration repository, audit-log repository, and the job processor.
 * One thing a junior engineer would likely get wrong when writing something similar: checking that the caller is an admin once and then skipping per-job state validation before retrying.
 */
import type { AppSession } from "@/lib/domain";
import { assertPlatformRole, assertTenantRole } from "@/lib/auth/permissions";
import { AppError } from "@/lib/http/app-error";
import type {
  ProcessQueuedJobsInput,
  RetryIntegrationJobInput,
} from "@/lib/validation/integrationSchemas";
import { processQueuedIntegrationJobs } from "@/jobs/process-queued-integration-jobs";
import { AuditLogRepository } from "@/repositories/audit-log-repository";
import { IntegrationRepository } from "@/repositories/integration-repository";
import { toRepositoryContext } from "@/repositories/repository-context";

export interface IntegrationServiceDeps {
  integrationRepository: Pick<
    IntegrationRepository,
    | "listConfigs"
    | "findConfigById"
    | "listJobs"
    | "createJob"
    | "findJobById"
    | "queueRetry"
    | "claimQueuedJobs"
    | "completeJob"
    | "addLog"
  >;
  auditLogRepository: Pick<AuditLogRepository, "create">;
}

export class IntegrationService {
  constructor(private readonly deps: IntegrationServiceDeps) {}

  async listConfigs(session: AppSession) {
    this.assertIntegrationAccess(session, "view integration configs");
    return this.deps.integrationRepository.listConfigs(toRepositoryContext(session));
  }

  async listJobs(session: AppSession) {
    this.assertIntegrationAccess(session, "view integration jobs");
    return this.deps.integrationRepository.listJobs(toRepositoryContext(session));
  }

  async queueJob(
    session: AppSession,
    input: {
      integrationConfigId: string;
      payloadJson: unknown;
    },
  ) {
    this.assertIntegrationAccess(session, "queue integration jobs");
    const ctx = toRepositoryContext(session);

    const config = await this.deps.integrationRepository.findConfigById(
      ctx,
      input.integrationConfigId,
    );

    if (!config) {
      throw new AppError(404, "Integration config not found.");
    }

    return this.deps.integrationRepository.createJob(ctx, {
      integrationConfigId: config.id,
      payloadJson: input.payloadJson,
      requestedByUserId: session.userId,
    });
  }

  async retryJob(
    session: AppSession,
    jobId: string,
    input: RetryIntegrationJobInput,
  ) {
    this.assertIntegrationAccess(session, "retry integration jobs");
    const ctx = toRepositoryContext(session);

    const job = await this.deps.integrationRepository.findJobById(ctx, jobId);

    if (!job) {
      throw new AppError(404, "Integration job not found.");
    }

    if (!["FAILED", "RETRY_REQUIRED"].includes(job.status)) {
      throw new AppError(
        409,
        `Only FAILED or RETRY_REQUIRED jobs can be retried. Current status: ${job.status}.`,
      );
    }

    const updatedJob = await this.deps.integrationRepository.queueRetry(ctx, {
      jobId,
      reason: input.reason,
    });

    if (!updatedJob) {
      throw new AppError(404, "Integration job not found for retry.");
    }

    return updatedJob;
  }

  async processQueuedJobs(session: AppSession, input: ProcessQueuedJobsInput) {
    if (!["PLATFORM_ADMIN", "PLATFORM_SUPPORT"].includes(session.platformRole)) {
      assertTenantRole(
        session,
        ["TENANT_ADMIN", "INTEGRATION_ADMIN"],
        "process integration jobs",
      );
    } else {
      assertPlatformRole(
        session,
        ["PLATFORM_ADMIN", "PLATFORM_SUPPORT"],
        "process integration jobs",
      );
    }

    return processQueuedIntegrationJobs(
      {
        ctx: toRepositoryContext(session),
        batchSize: input.batchSize,
      },
      this.deps,
    );
  }

  private assertIntegrationAccess(session: AppSession, action: string) {
    if (["PLATFORM_ADMIN", "PLATFORM_SUPPORT"].includes(session.platformRole)) {
      return;
    }

    assertTenantRole(session, ["TENANT_ADMIN", "INTEGRATION_ADMIN"], action);
  }
}
