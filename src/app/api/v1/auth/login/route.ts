import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { AppError, asErrorResponse } from "@/lib/errors";
import { verifyPassword } from "@/lib/password";
import { parseJson, requestMetadata } from "@/lib/request";
import { createSessionCookieValue, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "@/lib/session";

export async function POST(request: Request) {
  const { requestId } = await requestMetadata();
  try {
    const body = await parseJson<{ email: string; password: string }>(request);
    if (!body.email?.trim() || !body.password) {
      throw new AppError(422, "ID_INVALID", "Email and password are required.");
    }

    const user = await prisma.user.findUnique({ where: { email: body.email.trim() } });
    if (!user || !user.active || !verifyPassword(body.password, user.passwordHash)) {
      throw new AppError(403, "UNAUTHORIZED", "Invalid credentials.");
    }

    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_NAME, createSessionCookieValue(user.id), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS
    });

    return Response.json({ userId: user.id, role: user.role });
  } catch (error) {
    return asErrorResponse(error, requestId);
  }
}
