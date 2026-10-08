/**
 * What this file does: owns employee CRUD business rules, permission checks, and audit logging.
 * What calls it: employee route handlers under src/app/api/employees/.
 * What it calls: auth guards, repository context helpers, employee repository, and audit-log repository.
 * One thing a junior engineer would likely get wrong when writing something similar: validating only the request body shape and skipping cross-entity checks like "does this manager belong to the same tenant?"
 */
import type { AppSession } from "@/lib/domain";
import { assertTenantRole } from "@/lib/auth/permissions";
import { AppError } from "@/lib/http/app-error";
import type {
  CreateEmployeeInput,
  UpdateEmployeeInput,
} from "@/lib/validation/employeeSchemas";
import { AuditLogRepository } from "@/repositories/audit-log-repository";
import { EmployeeRepository } from "@/repositories/employee-repository";
import { toRepositoryContext } from "@/repositories/repository-context";

export interface EmployeeServiceDeps {
  employeeRepository: Pick<
    EmployeeRepository,
    "list" | "findById" | "employeeExists" | "orgUnitExists" | "create" | "update"
  >;
  auditLogRepository: Pick<AuditLogRepository, "create">;
}

export class EmployeeService {
  constructor(private readonly deps: EmployeeServiceDeps) {}

  async listEmployees(session: AppSession, search?: string) {
    assertTenantRole(
      session,
      ["TENANT_ADMIN", "HR_ADMIN", "MANAGER"],
      "view employee directories",
    );

    return this.deps.employeeRepository.list(toRepositoryContext(session), search);
  }

  async getEmployee(session: AppSession, employeeId: string) {
    assertTenantRole(
      session,
      ["TENANT_ADMIN", "HR_ADMIN", "MANAGER"],
      "view employee records",
    );

    const employee = await this.deps.employeeRepository.findById(
      toRepositoryContext(session),
      employeeId,
    );

    if (!employee) {
      throw new AppError(404, "Employee not found.");
    }

    return employee;
  }

  async createEmployee(session: AppSession, input: CreateEmployeeInput) {
    assertTenantRole(session, ["TENANT_ADMIN", "HR_ADMIN"], "create employees");

    const ctx = toRepositoryContext(session);

    await this.assertTenantReferences(ctx, input.managerId, input.orgUnitId);

    const employee = await this.deps.employeeRepository.create(ctx, input);
    await this.deps.auditLogRepository.create(ctx, {
      action: "EMPLOYEE_CREATED",
      entityType: "employee",
      entityId: employee.id,
      metadataJson: {
        employeeNumber: employee.employeeNumber,
        title: employee.title,
      },
    });

    return employee;
  }

  async updateEmployee(
    session: AppSession,
    employeeId: string,
    input: UpdateEmployeeInput,
  ) {
    assertTenantRole(session, ["TENANT_ADMIN", "HR_ADMIN"], "update employees");

    const ctx = toRepositoryContext(session);
    await this.assertTenantReferences(ctx, input.managerId, input.orgUnitId);

    const employee = await this.deps.employeeRepository.update(ctx, employeeId, input);

    if (!employee) {
      throw new AppError(404, "Employee not found.");
    }

    await this.deps.auditLogRepository.create(ctx, {
      action: "EMPLOYEE_UPDATED",
      entityType: "employee",
      entityId: employee.id,
      metadataJson: {
        fields: Object.keys(input),
      },
    });

    return employee;
  }

  private async assertTenantReferences(
    ctx: ReturnType<typeof toRepositoryContext>,
    managerId?: string,
    orgUnitId?: string,
  ) {
    if (managerId) {
      const managerExists = await this.deps.employeeRepository.employeeExists(ctx, managerId);

      if (!managerExists) {
        throw new AppError(400, "Manager must belong to the active tenant.");
      }
    }

    // ⚠️ SENIOR NOTE: global ids make cross-tenant foreign key bugs deceptively easy here unless every related lookup is tenant-scoped before the write.
    if (orgUnitId) {
      const orgUnitExists = await this.deps.employeeRepository.orgUnitExists(ctx, orgUnitId);

      if (!orgUnitExists) {
        throw new AppError(400, "Org unit must belong to the active tenant.");
      }
    }
  }
}
