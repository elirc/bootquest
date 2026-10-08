/**
 * What this file does: wires the default Prisma-backed repositories into concrete service instances.
 * What calls it: API route handlers and any server-side pages that need business services.
 * What it calls: repository constructors and service constructors.
 * One thing a junior engineer would likely get wrong when writing something similar: instantiating repositories ad hoc in every route until dependencies become inconsistent and hard to test.
 */
import { AuditLogRepository } from "@/repositories/audit-log-repository";
import { EmployeeRepository } from "@/repositories/employee-repository";
import { IntegrationRepository } from "@/repositories/integration-repository";
import { ReviewRepository } from "@/repositories/review-repository";
import { EmployeeService } from "@/services/employee-service";
import { IntegrationService } from "@/services/integration-service";
import { ReviewService } from "@/services/review-service";

const auditLogRepository = new AuditLogRepository();
const employeeRepository = new EmployeeRepository();
const reviewRepository = new ReviewRepository();
const integrationRepository = new IntegrationRepository();

export function createEmployeeService() {
  return new EmployeeService({
    employeeRepository,
    auditLogRepository,
  });
}

export function createReviewService() {
  return new ReviewService({
    reviewRepository,
    auditLogRepository,
  });
}

export function createIntegrationService() {
  return new IntegrationService({
    integrationRepository,
    auditLogRepository,
  });
}
