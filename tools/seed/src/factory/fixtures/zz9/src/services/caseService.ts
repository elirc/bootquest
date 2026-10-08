/*
 * What this file does:
 * Owns case-centric business rules, permissions, state transitions, and audit logging.
 * What calls it:
 * API routes under `src/app/api/cases/**`.
 * What it calls:
 * `src/lib/auth/authorize.ts`, `src/lib/workflow/caseWorkflow.ts`, `src/repositories/caseRepository.ts`, `src/repositories/auditLogRepository.ts`, `src/repositories/userRepository.ts`, and `src/lib/db.ts`.
 * One thing a junior engineer would likely get wrong:
 * Putting permission checks after the write instead of before the transaction starts.
 */
import crypto from "node:crypto";

import { CaseStatus, Prisma, UserRole } from "@prisma/client";

import { AuthorizationError, buildCaseAccessWhere, canViewRestrictedNotes, ensurePermission, type AuthenticatedActor } from "@/lib/auth/authorize";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { assertAllowedTransition, InvalidTransitionError } from "@/lib/workflow/caseWorkflow";
import { createAuditLog } from "@/repositories/auditLogRepository";
import {
  createAttachmentRecord,
  createCaseNote,
  createCaseRecord,
  createDeadlineRecord,
  findCaseById,
  listCases,
  type CaseDetailRecord,
  updateCaseRecord,
} from "@/repositories/caseRepository";
import { findUserById } from "@/repositories/userRepository";

type CaseFilters = {
  status?: CaseStatus;
  assignedToId?: string;
  owningTeamId?: string;
  search?: string;
};

function serializeCaseListItem(caseRecord: Awaited<ReturnType<typeof listCases>>[number]) {
  return {
    ...caseRecord,
    activeEscalationCount: caseRecord.escalations.length,
    nextDeadlineAt: caseRecord.deadlines[0]?.dueAt ?? null,
  };
}

function serializeCaseDetail(actor: AuthenticatedActor, caseRecord: CaseDetailRecord) {
  return {
    ...caseRecord,
    // âš ï¸ SENIOR NOTE: Restricted notes must be filtered after the scoped case lookup too; parent visibility does not imply child-note visibility.
    notes: caseRecord.notes.filter((note) => !note.isRestricted || canViewRestrictedNotes(actor)),
  };
}

function assertActorCanMutateTeam(actor: AuthenticatedActor, teamId: string) {
  if (actor.role === UserRole.ADMIN || actor.role === UserRole.OPERATIONS_MANAGER) {
    return;
  }

  if (!actor.teamId || actor.teamId !== teamId) {
    throw new AuthorizationError("You may only modify cases owned by your team.");
  }
}

async function getCaseForActor(actor: AuthenticatedActor, caseId: string) {
  const accessWhere = buildCaseAccessWhere(actor);
  const caseRecord = await findCaseById(caseId, accessWhere);

  if (!caseRecord) {
    throw new NotFoundError("The requested case was not found or is outside your visibility scope.");
  }

  return caseRecord;
}

async function assertAssignableUser(teamId: string, assignedToId?: string) {
  if (!assignedToId) {
    return;
  }

  const user = await findUserById(assignedToId);

  if (!user) {
    throw new NotFoundError("The assigned user does not exist.");
  }

  // Assignment is constrained to the owning team so queue ownership stays coherent.
  if (user.teamId !== teamId) {
    throw new InvalidTransitionError("Assigned users must belong to the owning team.");
  }
}

function buildCaseListWhere(actor: AuthenticatedActor, filters: CaseFilters): Prisma.CaseWhereInput {
  const accessWhere = buildCaseAccessWhere(actor);

  return {
    ...accessWhere,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.assignedToId ? { assignedToId: filters.assignedToId } : {}),
    ...(filters.owningTeamId ? { owningTeamId: filters.owningTeamId } : {}),
    ...(filters.search
      ? {
          OR: [
            { title: { contains: filters.search, mode: "insensitive" } },
            { caseNumber: { contains: filters.search, mode: "insensitive" } },
            { requesterName: { contains: filters.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

export async function listVisibleCases(actor: AuthenticatedActor, filters: CaseFilters) {
  ensurePermission(actor, "case:view");
  const cases = await listCases(buildCaseListWhere(actor, filters));

  return {
    items: cases.map(serializeCaseListItem),
  };
}

export async function getCaseDetail(actor: AuthenticatedActor, caseId: string) {
  ensurePermission(actor, "case:view");
  const caseRecord = await getCaseForActor(actor, caseId);

  return serializeCaseDetail(actor, caseRecord);
}

export async function createCase(
  actor: AuthenticatedActor,
  input: {
    title: string;
    description: string;
    priority: Prisma.CaseCreateInput["priority"];
    severity: number;
    requesterName: string;
    requesterEmail?: string;
    sourceSystem?: string;
    owningTeamId: string;
    assignedToId?: string;
  },
) {
  ensurePermission(actor, "case:create");
  assertActorCanMutateTeam(actor, input.owningTeamId);
  await assertAssignableUser(input.owningTeamId, input.assignedToId);

  const createdCase = await db.$transaction(async (tx) => {
    const today = new Date();
    const caseNumber = `CAS-${today.getUTCFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const record = await createCaseRecord(tx, {
      caseNumber,
      title: input.title,
      description: input.description,
      priority: input.priority,
      severity: input.severity,
      requesterName: input.requesterName,
      requesterEmail: input.requesterEmail || null,
      sourceSystem: input.sourceSystem || null,
      owningTeam: {
        connect: {
          id: input.owningTeamId,
        },
      },
      ...(input.assignedToId
        ? {
            assignedTo: {
              connect: {
                id: input.assignedToId,
              },
            },
          }
        : {}),
      createdBy: {
        connect: {
          id: actor.id,
        },
      },
    });

    await createAuditLog(tx, {
      caseId: record.id,
      actorId: actor.id,
      action: "case.created",
      entityType: "case",
      entityId: record.id,
      metadata: {
        status: record.status,
        owningTeamId: record.owningTeamId,
      },
    });

    return record;
  });

  return serializeCaseDetail(actor, createdCase);
}

export async function updateCase(
  actor: AuthenticatedActor,
  caseId: string,
  input: {
    title?: string;
    description?: string;
    priority?: Prisma.CaseUpdateInput["priority"];
    severity?: number;
    requesterName?: string;
    requesterEmail?: string;
    sourceSystem?: string;
    owningTeamId?: string;
    assignedToId?: string;
  },
) {
  ensurePermission(actor, "case:update");
  const existingCase = await getCaseForActor(actor, caseId);
  const nextTeamId = input.owningTeamId ?? existingCase.owningTeamId;

  assertActorCanMutateTeam(actor, existingCase.owningTeamId);

  if (input.owningTeamId && actor.role === UserRole.CASE_WORKER) {
    throw new AuthorizationError("Case workers cannot move cases between teams.");
  }

  await assertAssignableUser(nextTeamId, input.assignedToId);

  const updatedCase = await db.$transaction(async (tx) => {
    const record = await updateCaseRecord(tx, caseId, {
      title: input.title,
      description: input.description,
      priority: input.priority,
      severity: input.severity,
      requesterName: input.requesterName,
      requesterEmail: input.requesterEmail === undefined ? undefined : input.requesterEmail || null,
      sourceSystem: input.sourceSystem === undefined ? undefined : input.sourceSystem || null,
      ...(input.owningTeamId
        ? {
            owningTeam: {
              connect: {
                id: input.owningTeamId,
              },
            },
          }
        : {}),
      ...(input.assignedToId
        ? {
            assignedTo: {
              connect: {
                id: input.assignedToId,
              },
            },
          }
        : {}),
    });

    await createAuditLog(tx, {
      caseId,
      actorId: actor.id,
      action: "case.updated",
      entityType: "case",
      entityId: caseId,
      metadata: input,
    });

    return record;
  });

  return serializeCaseDetail(actor, updatedCase);
}

export async function addCaseNote(
  actor: AuthenticatedActor,
  caseId: string,
  input: {
    body: string;
    isRestricted: boolean;
  },
) {
  ensurePermission(actor, "note:create");
  const existingCase = await getCaseForActor(actor, caseId);
  assertActorCanMutateTeam(actor, existingCase.owningTeamId);

  if (input.isRestricted && !canViewRestrictedNotes(actor)) {
    throw new AuthorizationError("Your role cannot create restricted notes.");
  }

  const note = await db.$transaction(async (tx) => {
    const createdNote = await createCaseNote(tx, {
      caseId,
      authorId: actor.id,
      body: input.body,
      isRestricted: input.isRestricted,
    });

    await createAuditLog(tx, {
      caseId,
      actorId: actor.id,
      action: "case.note_created",
      entityType: "case_note",
      entityId: createdNote.id,
      metadata: {
        isRestricted: input.isRestricted,
      },
    });

    return createdNote;
  });

  return note;
}

export async function addCaseAttachment(
  actor: AuthenticatedActor,
  caseId: string,
  input: {
    fileName: string;
    storageKey: string;
    contentType: string;
    fileSizeBytes: number;
  },
) {
  ensurePermission(actor, "attachment:create");
  const existingCase = await getCaseForActor(actor, caseId);
  assertActorCanMutateTeam(actor, existingCase.owningTeamId);

  const attachment = await db.$transaction(async (tx) => {
    const createdAttachment = await createAttachmentRecord(tx, {
      caseId,
      uploadedById: actor.id,
      fileName: input.fileName,
      storageKey: input.storageKey,
      contentType: input.contentType,
      fileSizeBytes: input.fileSizeBytes,
    });

    await createAuditLog(tx, {
      caseId,
      actorId: actor.id,
      action: "case.attachment_created",
      entityType: "attachment",
      entityId: createdAttachment.id,
      metadata: {
        fileName: input.fileName,
        storageKey: input.storageKey,
      },
    });

    return createdAttachment;
  });

  return attachment;
}

export async function addCaseDeadline(
  actor: AuthenticatedActor,
  caseId: string,
  input: {
    label: string;
    dueAt: string;
  },
) {
  ensurePermission(actor, "deadline:manage");
  const existingCase = await getCaseForActor(actor, caseId);
  assertActorCanMutateTeam(actor, existingCase.owningTeamId);
  const dueAt = new Date(input.dueAt);

  if (Number.isNaN(dueAt.getTime())) {
    throw new InvalidTransitionError("Deadline due date is invalid.");
  }

  const deadline = await db.$transaction(async (tx) => {
    const createdDeadline = await createDeadlineRecord(tx, {
      caseId,
      createdById: actor.id,
      label: input.label,
      dueAt,
    });

    await createAuditLog(tx, {
      caseId,
      actorId: actor.id,
      action: "case.deadline_created",
      entityType: "deadline",
      entityId: createdDeadline.id,
      metadata: {
        dueAt: createdDeadline.dueAt.toISOString(),
      },
    });

    return createdDeadline;
  });

  return deadline;
}

export async function transitionCase(
  actor: AuthenticatedActor,
  caseId: string,
  input: {
    nextStatus: CaseStatus;
    comment?: string;
  },
) {
  ensurePermission(actor, "case:transition");
  const existingCase = await getCaseForActor(actor, caseId);
  assertActorCanMutateTeam(actor, existingCase.owningTeamId);

  assertAllowedTransition(existingCase.status, input.nextStatus);

  if (input.nextStatus === CaseStatus.IN_PROGRESS && !existingCase.assignedToId) {
    throw new InvalidTransitionError("A case must be assigned before it can move to IN_PROGRESS.");
  }

  if (input.nextStatus === CaseStatus.ESCALATED && !input.comment) {
    throw new InvalidTransitionError("Escalations require a reason in the transition comment.");
  }

  if (
    input.nextStatus === CaseStatus.CLOSED &&
    existingCase.escalations.some((escalation) => escalation.status !== "RESOLVED")
  ) {
    // âš ï¸ SENIOR NOTE: Closing a case with active escalations destroys the operational signal that something still needs attention.
    throw new InvalidTransitionError("Resolve open escalations before closing the case.");
  }

  const transitionedCase = await db.$transaction(async (tx) => {
    const record = await updateCaseRecord(tx, caseId, {
      status: input.nextStatus,
      closedAt: input.nextStatus === CaseStatus.CLOSED ? new Date() : null,
    });

    await createAuditLog(tx, {
      caseId,
      actorId: actor.id,
      action: "case.transitioned",
      entityType: "case",
      entityId: caseId,
      metadata: {
        from: existingCase.status,
        to: input.nextStatus,
        comment: input.comment ?? null,
      },
    });

    if (input.comment) {
      await createCaseNote(tx, {
        caseId,
        authorId: actor.id,
        body: input.comment,
        isRestricted: input.nextStatus === CaseStatus.ESCALATED,
      });
    }

    return record;
  });

  return serializeCaseDetail(actor, transitionedCase);
}

