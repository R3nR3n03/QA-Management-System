import { QamsRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { appendAudit } from "@/lib/audit";
import { ensureVersion } from "@/lib/validation";

export async function listControlledValues() {
  return prisma.controlledValue.findMany({
    orderBy: [{ catalogue: "asc" }, { value: "asc" }]
  });
}

export async function updateControlledValue(
  id: string,
  input: { active: boolean; version?: number; actorId: string; requestId: string }
) {
  const current = await prisma.controlledValue.findUnique({ where: { id } });
  if (!current) throw new AppError(404, "REFERENCE_NOT_FOUND", "Controlled value not found.", "id");
  ensureVersion(current.version, input.version);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.controlledValue.update({
      where: { id },
      data: {
        active: input.active,
        version: { increment: 1 },
        updatedBy: input.actorId
      }
    });
    await appendAudit(tx, {
      actorId: input.actorId,
      action: "CONTROLLED_VALUE_UPDATED",
      entityType: "ControlledValue",
      entityId: id,
      requestId: input.requestId,
      beforeAfterJson: { before: { active: current.active }, after: { active: updated.active } }
    });
    return updated;
  });
}

export async function updateUserRole(
  id: string,
  input: { role: QamsRole; version?: number; actorId: string; requestId: string }
) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new AppError(404, "REFERENCE_NOT_FOUND", "User not found.", "id");
  ensureVersion(user.version, input.version);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id },
      data: { role: input.role, version: { increment: 1 }, updatedBy: input.actorId }
    });
    await appendAudit(tx, {
      actorId: input.actorId,
      action: "USER_ROLE_UPDATED",
      entityType: "User",
      entityId: id,
      requestId: input.requestId,
      beforeAfterJson: { before: { role: user.role }, after: { role: updated.role } }
    });
    return updated;
  });
}
