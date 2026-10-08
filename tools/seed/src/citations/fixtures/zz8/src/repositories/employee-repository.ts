/**
 * What this file does: implements tenant-scoped employee persistence for the existing service layer.
 * What calls it: src/services/employee-service.ts through src/services/service-factory.ts.
 * What it calls: Prisma client in src/lib/db.ts.
 * One thing a junior engineer would likely get wrong when writing something similar: assuming a globally unique employee id is enough and forgetting tenantId in every query.
 */
import { db } from "@/lib/db";

import type { RepositoryContext } from "@/repositories/repository-context";
import type { EmployeeRecord } from "@/repositories/repository-types";

function mapEmployee(employee: {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  workEmail: string;
  title: string;
  employmentType: string;
  status: EmployeeRecord["status"];
  compensationCents: number;
  currency: string;
  startDate: Date;
  manager: { id: string; firstName: string; lastName: string } | null;
  orgUnit: { id: string; name: string; code: string } | null;
}): EmployeeRecord {
  return employee;
}

export class EmployeeRepository {
  async list(ctx: RepositoryContext, search?: string) {
    const employees = await db.employee.findMany({
      where: {
        tenantId: ctx.tenantId,
        ...(search
          ? {
              OR: [
                { firstName: { contains: search, mode: "insensitive" } },
                { lastName: { contains: search, mode: "insensitive" } },
                { title: { contains: search, mode: "insensitive" } },
                { employeeNumber: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: {
        manager: {
          select: { id: true, firstName: true, lastName: true },
        },
        orgUnit: {
          select: { id: true, name: true, code: true },
        },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    });

    return employees.map(mapEmployee);
  }

  async findById(ctx: RepositoryContext, employeeId: string) {
    const employee = await db.employee.findFirst({
      where: {
        tenantId: ctx.tenantId,
        id: employeeId,
      },
      include: {
        manager: {
          select: { id: true, firstName: true, lastName: true },
        },
        orgUnit: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    return employee ? mapEmployee(employee) : null;
  }

  async employeeExists(ctx: RepositoryContext, employeeId: string) {
    const count = await db.employee.count({
      where: {
        tenantId: ctx.tenantId,
        id: employeeId,
      },
    });

    return count > 0;
  }

  async orgUnitExists(ctx: RepositoryContext, orgUnitId: string) {
    const count = await db.orgUnit.count({
      where: {
        tenantId: ctx.tenantId,
        id: orgUnitId,
      },
    });

    return count > 0;
  }

  async create(
    ctx: RepositoryContext,
    input: {
      employeeNumber: string;
      firstName: string;
      lastName: string;
      workEmail: string;
      title: string;
      employmentType: string;
      status: EmployeeRecord["status"];
      compensationCents: number;
      currency: string;
      startDate: Date;
      managerId?: string;
      orgUnitId?: string;
    },
  ) {
    const employee = await db.employee.create({
      data: {
        tenantId: ctx.tenantId,
        ...input,
      },
      include: {
        manager: {
          select: { id: true, firstName: true, lastName: true },
        },
        orgUnit: {
          select: { id: true, name: true, code: true },
        },
      },
    });

    return mapEmployee(employee);
  }

  async update(
    ctx: RepositoryContext,
    employeeId: string,
    input: Partial<{
      title: string;
      status: EmployeeRecord["status"];
      compensationCents: number;
      managerId?: string;
      orgUnitId?: string;
    }>,
  ) {
    const result = await db.employee.updateMany({
      where: {
        tenantId: ctx.tenantId,
        id: employeeId,
      },
      data: input,
    });

    if (result.count === 0) {
      return null;
    }

    return this.findById(ctx, employeeId);
  }
}
