import { HourFormat } from "@prisma/client";
import { prisma } from "@/lib/db";
import { appendAudit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from "@/lib/password";
import { assertWithinRateLimit, authLimiter } from "@/lib/rate-limit";
import { isSupportedTimeZone } from "@/lib/time-zone";
import { requireNonBlank } from "@/lib/validation";

/**
 * Credential check, extracted so the web interface does not have to reach for
 * Prisma. `docs/architecture.md:33` keeps data access behind the domain layer for
 * every caller, and `src/app/api/v1/auth/login/route.ts` was the only route reading
 * the database directly for a reason other than a plain by-id lookup.
 *
 * Returns the fields a session needs and nothing else. `passwordHash` is never in
 * the return type - `docs/data-model.md:35` forbids returning it, and the API leaks
 * it once already (audit section 2.2).
 */
export type AuthenticatedUser = {
  id: string;
  email: string;
  displayName: string;
  role: import("@prisma/client").QamsRole;
};

/** `AuthenticatedUser` plus the display preferences the shell and `/account` both need. */
export type ProfileUser = AuthenticatedUser & {
  /** Their chosen zone, or null when they have never chosen one. */
  timeZone: string | null;
  /** Their chosen clock, or null when they have never chosen one. */
  hourFormat: HourFormat | null;
};

/**
 * How a person wants stamps drawn for them. Both fields are nullable and `null` means the
 * same thing in each: never chosen. See `viewerStampFormat` for how they resolve.
 */
export type DisplayPreferences = {
  timeZone: string | null;
  hourFormat: HourFormat | null;
};

/** Every legal clock, for validating one that arrived from a form field. */
const HOUR_FORMATS: readonly HourFormat[] = [HourFormat.H12, HourFormat.H24];

/**
 * Revoke every session this user currently holds (A6).
 *
 * Stamping `sessionsValidFrom` with the current instant refuses every token issued before
 * it — every copy of the cookie, wherever it is — on its next request. That is the whole
 * point: deleting the client's cookie, which is all logout did before, does nothing to a
 * copy someone else is holding.
 *
 * Deliberately does NOT touch `version`. That column is the optimistic-concurrency token
 * for `PATCH /users/{id}/role`; bumping it here would make an unrelated sign-out invalidate
 * a QA Lead's in-flight role change with a spurious `VERSION_CONFLICT`.
 *
 * No `AuditEvent` either. `docs/business-rules-and-validation.md:50` requires audit events
 * for role changes, configuration changes, imports, record creation, updates, lifecycle
 * transitions and readiness decisions — a sign-out is none of those, and the login route
 * already establishes the precedent that authentication events are recorded in the
 * structured log rather than the audit trail.
 */
export async function revokeSessions(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { sessionsValidFrom: new Date() }
  });
}

/** The signed-in user's own details, for the application shell. */
export async function profile(userId: string): Promise<ProfileUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      timeZone: true,
      hourFormat: true
    }
  });
  return user;
}

/**
 * Self-service password change. No role gate on purpose: every role manages its own
 * credential and only its own — the target is always the authenticated caller, never
 * a parameter, so this cannot become an admin path by accident.
 *
 * On success every OTHER session dies: `sessionsValidFrom` is stamped inside the same
 * transaction as the new hash, so a stolen cookie stops working the moment the
 * password changes — which is the main reason people change passwords. The caller is
 * kept signed in by issuing a fresh cookie stamped with the SAME instant (equal
 * `issuedAt` passes `isSessionRevoked`); the returned `issuedAtMs` exists for that.
 *
 * The verify is throttled through `authLimiter` on failures only, keyed to the
 * account: this endpoint takes a password guess like login does
 * (`api-and-security.md:43` requires auth endpoints be rate limited), but a
 * successful change must never count toward a lockout.
 *
 * The audit event records that the credential changed and that sessions were
 * revoked — never the password, the hash, or anything derivable from them.
 */
export async function changeOwnPassword(
  userId: string,
  input: { currentPassword: string; newPassword: string },
  requestId: string
): Promise<{ issuedAtMs: number }> {
  requireNonBlank(input.currentPassword, "currentPassword", "Your current password is required.");
  requireNonBlank(input.newPassword, "newPassword", "A new password is required.");
  if (input.newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new AppError(
      422,
      "ID_INVALID",
      `The new password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      "newPassword"
    );
  }

  const throttleKey = `password-change:user:${userId}`;
  assertWithinRateLimit(authLimiter.peek(throttleKey));

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.active) {
    throw new AppError(403, "UNAUTHORIZED", "Invalid credentials.");
  }
  if (!verifyPassword(input.currentPassword, user.passwordHash)) {
    assertWithinRateLimit(authLimiter.consume(throttleKey));
    throw new AppError(403, "UNAUTHORIZED", "Your current password is incorrect.", "currentPassword");
  }

  const now = new Date();
  const passwordHash = hashPassword(input.newPassword);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash, sessionsValidFrom: now }
    });
    await appendAudit(tx, {
      actorId: userId,
      action: "USER_PASSWORD_CHANGED",
      entityType: "User",
      entityId: userId,
      requestId,
      beforeAfterJson: { after: { credentialRotated: true, otherSessionsRevoked: true } }
    });
  });

  return { issuedAtMs: now.getTime() };
}

/**
 * Self-service change of the caller's own **display preferences** — the zone their screens
 * render stamps in, and whether those stamps use a 12- or 24-hour clock (`CONTEXT.md`,
 * ADR-0007).
 *
 * No role gate, and the target is always the authenticated caller rather than a parameter,
 * exactly as `changeOwnPassword` is built: these are facts about where a person sits and how
 * they read a clock, and they are the only authority on both — so this must not be able to
 * become an admin path by accident. `docs/roles-workflows.md` has no row for setting somebody
 * else's, and none is invented here.
 *
 * Both fields take `null` as a real choice rather than an absence of one. Clearing the zone
 * puts the viewer back on the organization's and — unlike storing that zone's name — keeps
 * them there if the deployment later moves; clearing the clock returns them to the 24-hour
 * default. That is the whole reason both columns are nullable.
 *
 * ONE service and ONE audit event for both, because they answer one question. A viewer who
 * changes their zone and their clock in the same sitting had a single intention, and splitting
 * it would put two rows in an append-only log for it.
 *
 * ## Why this changes NOTHING except what is rendered
 *
 * No timestamp is rewritten and no query is re-scoped. Every stored instant is untouched UTC
 * (`docs/data-model.md`), and nothing in QAMS filters by calendar day, so neither preference
 * can move a record in or out of any result. They decide how an instant is drawn and stop
 * there.
 *
 * ## Why `version` is deliberately NOT bumped
 *
 * `User.version` is the optimistic-concurrency token for `PATCH /users/{id}/role`, and
 * bumping it here would make a person changing their own preferences invalidate a QA Lead's
 * in-flight role change with a spurious `VERSION_CONFLICT`. That is the identical reasoning
 * `revokeSessions` and `changeOwnPassword` already record for the identical situation — a
 * self-service write to columns the role endpoint does not read.
 *
 * The audit event IS written, and that half is not optional: it is the only thing that can
 * later answer why somebody's screens started reading differently.
 */
export async function changeOwnDisplayPreferences(
  userId: string,
  input: DisplayPreferences,
  requestId: string
): Promise<DisplayPreferences> {
  // Validated against the runtime's own IANA data rather than a list this project keeps.
  // A stored zone the platform cannot format would throw at render, on every screen, for
  // one person — a failure they could not undo from a screen that no longer draws.
  if (input.timeZone !== null && !isSupportedTimeZone(input.timeZone)) {
    throw new AppError(
      422,
      "ID_INVALID",
      "That is not a time zone this system recognises. Choose one from the list.",
      "timeZone"
    );
  }

  // The enum is checked rather than trusted: this arrives from a form field, and Prisma would
  // otherwise reject an unknown member with a database error rather than a field-scoped 422.
  if (input.hourFormat !== null && !HOUR_FORMATS.includes(input.hourFormat)) {
    throw new AppError(422, "ID_INVALID", "Choose a 12-hour or 24-hour clock.", "hourFormat");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timeZone: true, hourFormat: true }
  });
  if (!user) {
    throw new AppError(403, "UNAUTHORIZED", "Authentication required.");
  }

  const after: DisplayPreferences = { timeZone: input.timeZone, hourFormat: input.hourFormat };

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: after });
    await appendAudit(tx, {
      actorId: userId,
      action: "USER_DISPLAY_PREFERENCES_CHANGED",
      entityType: "User",
      entityId: userId,
      requestId,
      beforeAfterJson: {
        before: { timeZone: user.timeZone, hourFormat: user.hourFormat },
        after
      }
    });
  });

  return after;
}

export async function authenticate(email: string, password: string): Promise<AuthenticatedUser> {
  const user = await prisma.user.findUnique({ where: { email: email.trim() } });

  // One message and one status for "no such account", "inactive account" and "wrong
  // password" alike. Distinguishing them would confirm which addresses exist, and
  // docs/api-and-security.md:33 forbids exposing more than the requester asked for.
  if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
    throw new AppError(403, "UNAUTHORIZED", "Invalid credentials.");
  }

  return { id: user.id, email: user.email, displayName: user.displayName, role: user.role };
}
