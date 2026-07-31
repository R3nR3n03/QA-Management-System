"use server";

import { cookies } from "next/headers";
import { changeOwnPassword } from "@/domain/auth";
import { createSessionCookieValue, SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/session";
import { failState, runAction, type FormState } from "@/ui/action";

export async function changePasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  // Captured from the actor DURING the action: once the change lands, the cookie this
  // request arrived with is already revoked, so re-authenticating afterwards would
  // throw and sign the caller out — the opposite of what the fresh cookie is for.
  let userId = "";

  const result = await runAction((actor) => {
    userId = actor.userId;
    return changeOwnPassword(
      actor.userId,
      {
        currentPassword: String(formData.get("currentPassword") ?? ""),
        newPassword: String(formData.get("newPassword") ?? "")
      },
      actor.requestId
    );
  });

  if (!result.ok) return failState(result);

  // The domain revoked every session as of the change instant; a fresh cookie stamped
  // with that same instant keeps THIS browser signed in while every other copy of the
  // old cookie dies. Same pattern as the API route.
  const store = await cookies();
  store.set(
    SESSION_COOKIE_NAME,
    createSessionCookieValue(userId, result.data.issuedAtMs),
    sessionCookieOptions()
  );

  return {
    title: "Password changed",
    detail: "Everywhere else you were signed in has been signed out. This browser stays signed in.",
    success: true
  };
}
