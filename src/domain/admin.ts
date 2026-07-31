import { QamsRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { appendAudit } from "@/lib/audit";
import { ensureRole, RoleSets } from "@/lib/rbac";
import { ensureVersion } from "@/lib/validation";
import { withVersionCheck } from "@/lib/optimistic-lock";

export async function listControlledValues() {
  return prisma.controlledValue.findMany({
    orderBy: [{ catalogue: "asc" }, { value: "asc" }]
  });
}

// The QA-Lead gates below live HERE, not in the routes. `docs/api-and-security.md:38`
// requires the role/action matrix be enforced in domain services; these two were the
// last services gated only at the route, so any non-HTTP caller reached privileged
// mutation with no authorization at all (implementation audit §5.9).
export async function updateControlledValue(
  id: string,
  input: { active: boolean; version?: number; actorId: string; actorRole: QamsRole; requestId: string }
) {
  ensureRole([...RoleSets.canAdmin], input.actorRole);
  const current = await prisma.controlledValue.findUnique({ where: { id } });
  if (!current) throw new AppError(404, "REFERENCE_NOT_FOUND", "Controlled value not found.", "id");
  const expectedVersion = ensureVersion(current.version, input.version);

  return withVersionCheck(() => prisma.$transaction(async (tx) => {
    const updated = await tx.controlledValue.update({
      where: { id, version: expectedVersion },
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
  }));
}

/**
 * The only User fields this API returns.
 *
 * `docs/data-model.md:35` is absolute: "passwordHash is never returned by the API or
 * written to audit logs." `PATCH /users/{id}/role` returned the whole Prisma record,
 * hash included (`IMPLEMENTATION-AUDIT-2026-07-31.md` §2.2, reproduced against a live
 * server before this fix).
 *
 * A `select` rather than a delete-after-the-fact, so the hash is never read out of the
 * database at all and the return type cannot carry it — a future field added to the
 * `User` model is excluded by default instead of leaking by default.
 *
 * `createdBy` / `updatedBy` are also absent: they are internal identifiers of *other*
 * users, and `docs/api-and-security.md:33` forbids exposing "internal identifiers
 * beyond the requested record". `version` IS included because
 * `docs/api-and-security.md:5` requires a mutation to "return the updated record with
 * its new `version`".
 */
export const USER_RESPONSE_SELECT = {
  id: true,
  email: true,
  displayName: true,
  role: true,
  active: true,
  version: true
} as const;

export async function listUsers(actorRole: QamsRole) {
  // People management is a QA-Lead capability (`roles-workflows.md:16`), and the
  // projection keeps passwordHash out by construction.
  ensureRole([...RoleSets.canAdmin], actorRole);
  return prisma.user.findMany({
    select: { ...USER_RESPONSE_SELECT },
    orderBy: { displayName: "asc" }
  });
}

export async function getUserRole(id: string, actorRole: QamsRole) {
  // Same gate as the mutation: the role endpoint pair is a QA-Lead capability
  // (`roles-workflows.md:16`), and the projection keeps the response to the
  // documented fields (`api-and-security.md:16` lists GET alongside PATCH).
  ensureRole([...RoleSets.canAdmin], actorRole);
  const user = await prisma.user.findUnique({
    where: { id },
    select: { ...USER_RESPONSE_SELECT }
  });
  if (!user) throw new AppError(404, "REFERENCE_NOT_FOUND", "User not found.", "id");
  return user;
}

export async function updateUserRole(
  id: string,
  input: { role: QamsRole; version?: number; actorId: string; actorRole: QamsRole; requestId: string }
) {
  ensureRole([...RoleSets.canAdmin], input.actorRole);
  const user = await prisma.user.findUnique({
    where: { id },
    select: { ...USER_RESPONSE_SELECT }
  });
  if (!user) throw new AppError(404, "REFERENCE_NOT_FOUND", "User not found.", "id");
  const expectedVersion = ensureVersion(user.version, input.version);

  return withVersionCheck(() => prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id, version: expectedVersion },
      data: { role: input.role, version: { increment: 1 }, updatedBy: input.actorId },
      select: { ...USER_RESPONSE_SELECT }
    });
    await appendAudit(tx, {
      actorId: input.actorId,
      action: "USER_ROLE_UPDATED",
      entityType: "User",
      entityId: id,
      requestId: input.requestId,
      // Already narrow, and deliberately so: data-model.md:35 bars the hash from the
      // audit log as well as from responses.
      beforeAfterJson: { before: { role: user.role }, after: { role: updated.role } }
    });
    return updated;
  }));
}
