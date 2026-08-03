import { QamsRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { appendAudit } from "@/lib/audit";
import { runPaged, type PageRequest } from "@/lib/pagination";
import type { ControlledCatalogue } from "@/lib/controlled-value-catalogues";
import { hashPassword, MIN_PASSWORD_LENGTH } from "@/lib/password";
import { ensureRole, RoleSets } from "@/lib/rbac";
import { ensureVersion, requireNonBlank, requireNonBlankIfProvided } from "@/lib/validation";
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
 * Add a value to one of the three documented catalogues. QA-Lead-gated like every
 * other administration mutation (`roles-workflows.md:16`). The value is trimmed and
 * compared exactly as `ensureActiveControlledValue` will later compare it — case- and
 * whitespace-sensitively against the `(catalogue, value)` unique key — so a value that
 * can be created here is exactly the value test cases and defects can then use.
 * Created active; deactivation is the only removal path (`updateControlledValue`).
 */
export async function createControlledValue(
  input: { catalogue: ControlledCatalogue; value: string; actorId: string; actorRole: QamsRole; requestId: string }
) {
  ensureRole([...RoleSets.canAdmin], input.actorRole);
  requireNonBlank(input.value, "value", "A value is required.");
  const value = input.value.trim();

  const existing = await prisma.controlledValue.findUnique({
    where: { catalogue_value: { catalogue: input.catalogue, value } }
  });
  if (existing) {
    throw new AppError(409, "ID_DUPLICATE", "That value already exists in this catalogue.", "value");
  }

  return prisma.$transaction(async (tx) => {
    const created = await tx.controlledValue.create({
      data: {
        catalogue: input.catalogue,
        value,
        createdBy: input.actorId,
        updatedBy: input.actorId
      }
    });
    await appendAudit(tx, {
      actorId: input.actorId,
      action: "CONTROLLED_VALUE_CREATED",
      entityType: "ControlledValue",
      entityId: created.id,
      requestId: input.requestId,
      beforeAfterJson: { after: { catalogue: created.catalogue, value: created.value, active: created.active } }
    });
    return created;
  });
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

/**
 * Create a user account. `roles-workflows.md:16` makes user management a QA-Lead
 * capability; accounts previously came only from the seed. The initial password is
 * chosen by the QA Lead and communicated out of band — there is no self-service
 * password change in v1, which is a known follow-up.
 *
 * Returns the `USER_RESPONSE_SELECT` projection, so the hash can never leave this
 * function, and the audit event carries no credential material at all.
 */
export async function createUser(
  input: { email: string; displayName: string; role: QamsRole; password: string },
  actor: { userId: string; role: QamsRole; requestId: string }
) {
  ensureRole([...RoleSets.canAdmin], actor.role);
  requireNonBlank(input.email, "email", "Email is required.");
  requireNonBlank(input.displayName, "displayName", "Display name is required.");
  requireNonBlank(input.password, "password", "An initial password is required.");
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new AppError(
      422,
      "ID_INVALID",
      `The initial password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      "password"
    );
  }

  const email = input.email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new AppError(409, "ID_DUPLICATE", "A user with that email already exists.", "email");
  }

  const passwordHash = hashPassword(input.password);

  return prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email,
        displayName: input.displayName.trim(),
        role: input.role,
        passwordHash,
        createdBy: actor.userId,
        updatedBy: actor.userId
      },
      select: { ...USER_RESPONSE_SELECT }
    });
    await appendAudit(tx, {
      actorId: actor.userId,
      action: "USER_CREATED",
      entityType: "User",
      entityId: created.id,
      requestId: actor.requestId,
      // Deliberately narrow: no hash, no password, and data-model.md:35 bars
      // credential material from the audit log the same as from responses.
      beforeAfterJson: { after: { email: created.email, displayName: created.displayName, role: created.role } }
    });
    return created;
  });
}

export async function listUsers(actorRole: QamsRole, options: PageRequest = {}) {
  // People management is a QA-Lead capability (`roles-workflows.md:16`), and the
  // projection keeps passwordHash out by construction.
  ensureRole([...RoleSets.canAdmin], actorRole);
  return runPaged(
    options,
    (window) =>
      prisma.user.findMany({
        select: { ...USER_RESPONSE_SELECT },
        orderBy: { displayName: "asc" },
        ...window
      }),
    () => prisma.user.count()
  );
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

/**
 * Update a person's display name and/or email. User management is a QA-Lead
 * capability (`roles-workflows.md:16`); there is no self-service profile edit in v1.
 * Email is normalized exactly as `createUser` normalizes it (trim + lowercase) and a
 * duplicate is the same 409, so an address can never exist in two casings.
 */
export async function updateUserProfile(
  id: string,
  input: {
    displayName?: string;
    email?: string;
    version?: number;
    actorId: string;
    actorRole: QamsRole;
    requestId: string;
  }
) {
  ensureRole([...RoleSets.canAdmin], input.actorRole);
  requireNonBlankIfProvided(input.displayName, "displayName", "Display name cannot be blank.");
  requireNonBlankIfProvided(input.email, "email", "Email cannot be blank.");
  if (input.displayName === undefined && input.email === undefined) {
    throw new AppError(422, "ID_INVALID", "Provide displayName or email.");
  }

  const user = await prisma.user.findUnique({ where: { id }, select: { ...USER_RESPONSE_SELECT } });
  if (!user) throw new AppError(404, "REFERENCE_NOT_FOUND", "User not found.", "id");
  const expectedVersion = ensureVersion(user.version, input.version);

  const email = input.email?.trim().toLowerCase();
  if (email !== undefined && email !== user.email) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new AppError(409, "ID_DUPLICATE", "A user with that email already exists.", "email");
    }
  }

  return withVersionCheck(() => prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id, version: expectedVersion },
      data: {
        displayName: input.displayName?.trim() ?? user.displayName,
        email: email ?? user.email,
        version: { increment: 1 },
        updatedBy: input.actorId
      },
      select: { ...USER_RESPONSE_SELECT }
    });
    await appendAudit(tx, {
      actorId: input.actorId,
      action: "USER_PROFILE_UPDATED",
      entityType: "User",
      entityId: id,
      requestId: input.requestId,
      beforeAfterJson: {
        before: { displayName: user.displayName, email: user.email },
        after: { displayName: updated.displayName, email: updated.email }
      }
    });
    return updated;
  }));
}

/**
 * Deactivate or reactivate an account. Deactivation is the ONLY removal path — no
 * user is ever deleted, so audit actors and `createdBy`/`updatedBy` references stay
 * resolvable forever (`docs/data-model.md` common record convention).
 *
 * Guardrails, checked inside the transaction so a concurrent role change or
 * deactivation cannot slip past them:
 * - **No self-deactivation.** Locking yourself out is never what was meant, and the
 *   last-lead rule below would otherwise be circumventable one self-service step at
 *   a time.
 * - **The last active QA Lead cannot be deactivated.** Every administration
 *   capability is lead-gated (`roles-workflows.md:16`); zero active leads would make
 *   user management, controlled values and reconciliation permanently unreachable.
 *
 * Session note: `requireAuth` re-reads `User.active` on every request, so a
 * deactivated person's existing sessions stop working immediately. `sessionsValidFrom`
 * is ALSO stamped on deactivation, inside the same transaction, so cookies issued
 * before the deactivation stay dead even if the account is later reactivated —
 * reactivation means "may log in again", not "old sessions resume".
 */
export async function setUserActive(
  id: string,
  input: { active: boolean; version?: number; actorId: string; actorRole: QamsRole; requestId: string }
) {
  ensureRole([...RoleSets.canAdmin], input.actorRole);
  const user = await prisma.user.findUnique({
    where: { id },
    select: { ...USER_RESPONSE_SELECT }
  });
  if (!user) throw new AppError(404, "REFERENCE_NOT_FOUND", "User not found.", "id");
  const expectedVersion = ensureVersion(user.version, input.version);

  return withVersionCheck(() => prisma.$transaction(async (tx) => {
    if (!input.active) {
      if (id === input.actorId) {
        throw new AppError(422, "FORBIDDEN_TRANSITION", "You cannot deactivate your own account.", "active");
      }
      const otherActiveLeads = await tx.user.count({
        where: { role: QamsRole.QA_LEAD, active: true, NOT: { id } }
      });
      if (user.role === QamsRole.QA_LEAD && user.active && otherActiveLeads === 0) {
        throw new AppError(
          422,
          "FORBIDDEN_TRANSITION",
          "The last active QA Lead cannot be deactivated.",
          "active"
        );
      }
    }

    const updated = await tx.user.update({
      where: { id, version: expectedVersion },
      data: {
        active: input.active,
        // Deactivation kills existing sessions permanently (see the doc comment);
        // reactivation deliberately does not touch the stamp.
        ...(input.active ? {} : { sessionsValidFrom: new Date() }),
        version: { increment: 1 },
        updatedBy: input.actorId
      },
      select: { ...USER_RESPONSE_SELECT }
    });
    await appendAudit(tx, {
      actorId: input.actorId,
      action: input.active ? "USER_REACTIVATED" : "USER_DEACTIVATED",
      entityType: "User",
      entityId: id,
      requestId: input.requestId,
      beforeAfterJson: { before: { active: user.active }, after: { active: updated.active } }
    });
    return updated;
  }));
}
