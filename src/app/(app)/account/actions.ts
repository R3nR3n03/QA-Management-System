"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import type { HourFormat } from "@prisma/client";
import { changeOwnDisplayPreferences, changeOwnPassword } from "@/domain/auth";
import { createSessionCookieValue, SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/session";
import { failState, refreshScreen, runAction, type FormState } from "@/ui/action";

export async function changePasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  // Captured from the actor DURING the action: once the change lands, the cookie this
  // request arrived with is already revoked, so re-authenticating afterwards would
  // throw and sign the caller out — the opposite of what the fresh cookie is for.
  let userId = "";

  const newPassword = String(formData.get("newPassword") ?? "");

  /*
   * The two entries must agree, and this is the one check that cannot be left to the domain:
   * the confirmation is not a fact about the credential, it is a fact about the FORM — a
   * second reading of an input nobody can see, which is why it never reaches
   * `changeOwnPassword`. Shape validation, the same job a route handler's Zod schema does
   * before it calls a service, so no policy moves out of the domain here.
   *
   * The form checks this as it is typed as well. That check is JavaScript and this submit is
   * not, so without this one a no-JS browser could still set a mistyped password — and a
   * mistyped password is invisible until the next sign-in, by which time nothing on screen
   * can be compared against anything.
   */
  if (newPassword !== String(formData.get("confirmPassword") ?? "")) {
    return {
      title: "The two new passwords do not match",
      detail: "Type the new password again in the confirmation field. Nothing was changed.",
      field: "confirmPassword"
    };
  }

  const result = await runAction((actor) => {
    userId = actor.userId;
    return changeOwnPassword(
      actor.userId,
      {
        currentPassword: String(formData.get("currentPassword") ?? ""),
        newPassword
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

/**
 * Set — or clear — the viewer's own zone and clock, in one submit.
 *
 * An empty string clears either one. A `<select>` cannot submit null, and "no preference" is a
 * real choice rather than an empty field: clearing the zone puts the viewer on the
 * organization's and keeps them there if the deployment later moves, and clearing the clock
 * returns them to the 24-hour default (ADR-0007). So blank is mapped deliberately here instead
 * of being rejected as missing input.
 *
 * The clock is passed through as the raw string and validated in the domain against the enum.
 * Narrowing it here would put a second copy of "which clocks are legal" in a server action,
 * and the domain is the single enforcement point.
 *
 * Revalidated at the LAYOUT, not this page. The zone is stated in the shell and both
 * preferences are drawn into every stamp on every screen, so anything narrower would leave a
 * stale sidebar over freshly formatted rows — the two disagreeing about the one fact the
 * change is for.
 */
export async function changeDisplayPreferencesAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const zone = String(formData.get("timeZone") ?? "").trim();
  const clock = String(formData.get("hourFormat") ?? "").trim();

  const result = await runAction((actor) =>
    changeOwnDisplayPreferences(
      actor.userId,
      {
        timeZone: zone === "" ? null : zone,
        hourFormat: clock === "" ? null : (clock as HourFormat)
      },
      actor.requestId
    )
  );

  if (!result.ok) return failState(result);

  revalidatePath("/", "layout");
  // Returns `never` — `refreshScreen` signals by throwing a redirect — so this satisfies the
  // FormState signature without inventing a success state nobody will ever render.
  return refreshScreen("/account");
}
