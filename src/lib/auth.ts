import { QamsRole } from "@prisma/client";
import { cookies } from "next/headers";
import { prisma } from "./db";
import { AppError } from "./errors";
import { SESSION_COOKIE_NAME, verifySessionCookieValue } from "./session";

export type AuthContext = {
  userId: string;
  role: QamsRole;
};

export async function requireAuth(): Promise<AuthContext> {
  const cookieStore = await cookies();
  const userId = verifySessionCookieValue(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  if (!userId) {
    throw new AppError(403, "UNAUTHORIZED", "Authentication required.");
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.active) {
    throw new AppError(403, "UNAUTHORIZED", "Authentication required.");
  }

  return { userId: user.id, role: user.role };
}
