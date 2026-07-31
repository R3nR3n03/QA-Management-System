import { QamsRole } from "@prisma/client";
import { cookies } from "next/headers";
import { prisma } from "./db";
import { AppError } from "./errors";
import { isSessionRevoked, SESSION_COOKIE_NAME, verifySessionCookieValue } from "./session";

export type AuthContext = {
  userId: string;
  role: QamsRole;
};

/**
 * The single authentication check for every request.
 *
 * Three properties hold here and all three must keep holding:
 *
 * 1. **The role is resolved server-side, from the database, on every request** — a client
 *    never supplies it (`docs/api-and-security.md:37`).
 * 2. **Deactivation takes effect immediately**, because the user row is re-read each time
 *    rather than trusted from the token.
 * 3. **Revoked sessions are refused** (A6, added here). It costs nothing extra: the row was
 *    already being read, so this is one more column and one pure comparison.
 *
 * Every failure returns the identical `403 UNAUTHORIZED` with the same message. Expired,
 * forged, revoked, deactivated and unknown-user are deliberately indistinguishable to the
 * caller — `docs/api-and-security.md:33` forbids exposing authorization detail, and telling
 * an attacker *why* a token failed is exactly that.
 */
export async function requireAuth(): Promise<AuthContext> {
  const cookieStore = await cookies();
  const session = verifySessionCookieValue(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  if (!session) {
    throw new AppError(403, "UNAUTHORIZED", "Authentication required.");
  }

  // Selected explicitly: this previously loaded the whole row, `passwordHash` included, on
  // every single authenticated request. `docs/data-model.md:35` bars the hash from responses
  // and logs, and the surest way to honour that is never to read it.
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, role: true, active: true, sessionsValidFrom: true }
  });

  if (!user || !user.active) {
    throw new AppError(403, "UNAUTHORIZED", "Authentication required.");
  }

  if (isSessionRevoked(session.issuedAt, user.sessionsValidFrom)) {
    throw new AppError(403, "UNAUTHORIZED", "Authentication required.");
  }

  return { userId: user.id, role: user.role };
}
