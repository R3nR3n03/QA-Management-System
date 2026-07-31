"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authenticate } from "@/domain/auth";
import { AppError } from "@/lib/errors";
import { createSessionCookieValue, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "@/lib/session";
import { errorCopy } from "@/ui/error-copy";

export type LoginState = { title: string; detail: string } | null;

/**
 * Sign in. Not wrapped in `runAction` — that helper authenticates first, which is
 * the one thing this cannot do.
 *
 * NOTE: no rate limiting. `docs/api-and-security.md:43` requires it on
 * authentication endpoints and none exists anywhere in the project (audit section 5.5).
 * A server action is a new unthrottled entry point to the same credential check, so
 * this inherits that gap rather than introducing it — but it does widen the surface,
 * and it should be closed before anything is deployed.
 */
export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!email.trim() || !password) {
    return { title: "Enter your email and password.", detail: "Both are needed to sign in." };
  }

  try {
    const user = await authenticate(email, password);
    const store = await cookies();
    store.set(SESSION_COOKIE_NAME, createSessionCookieValue(user.id), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS
    });
  } catch (error) {
    if (error instanceof AppError) {
      const copy = errorCopy(error.code, error.field);
      // Deliberately not the generic UNAUTHORIZED wording: at a sign-in form the
      // useful sentence is about the credentials, not about roles.
      return error.code === "UNAUTHORIZED"
        ? {
            title: "That email and password don't match.",
            detail: "Check both and try again. If the account was deactivated, a QA Lead can restore it."
          }
        : { title: copy.title, detail: copy.detail };
    }
    return { title: "Something broke on our side.", detail: "Nothing was saved. Try again." };
  }

  redirect("/my-work");
}

export async function signOut(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
  redirect("/login");
}
