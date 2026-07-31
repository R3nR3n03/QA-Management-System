import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { verifyPassword } from "@/lib/password";

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

/** The signed-in user's own details, for the application shell. */
export async function profile(userId: string): Promise<AuthenticatedUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, displayName: true, role: true }
  });
  return user;
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
