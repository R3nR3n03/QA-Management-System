"use server";

import { QamsRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import {
  createUser,
  resetUserPassword,
  setUserActive,
  updateUserProfile,
  updateUserRole
} from "@/domain/admin";
import { failState, refreshScreen, runAction, type FormState } from "@/ui/action";

/**
 * People administration. Every form is on the People screen and leaves the viewer there, so
 * each action ends in `refreshScreen`: a revalidate-only action never commits its refresh,
 * so a role change or a deactivation stayed off screen until a manual reload — and a role
 * change that appears not to have happened is the kind of thing an administrator does twice
 * (see `src/ui/action.ts`). Returning to the submitted URL keeps the page and rows-per-page
 * the list was showing.
 *
 * The password reset is the one exception, and `resetUserPasswordAction` says why.
 */

export async function createUserAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const result = await runAction((actor) =>
    createUser(
      {
        email: String(formData.get("email") ?? ""),
        displayName: String(formData.get("displayName") ?? ""),
        role: String(formData.get("role") ?? "") as QamsRole,
        password: String(formData.get("password") ?? "")
      },
      actor
    )
  );

  if (!result.ok) return failState(result);
  revalidatePath("/admin/users");
  return refreshScreen("/admin/users");
}

export async function updateUserRoleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const result = await runAction((actor) =>
    updateUserRole(String(formData.get("userId") ?? ""), {
      role: String(formData.get("role") ?? "") as QamsRole,
      version: Number(formData.get("version")),
      actorId: actor.userId,
      actorRole: actor.role,
      requestId: actor.requestId
    })
  );

  if (!result.ok) return failState(result);
  revalidatePath("/admin/users");
  return refreshScreen("/admin/users");
}

export async function updateUserProfileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const result = await runAction((actor) =>
    updateUserProfile(String(formData.get("userId") ?? ""), {
      displayName: String(formData.get("displayName") ?? ""),
      email: String(formData.get("email") ?? ""),
      version: Number(formData.get("version")),
      actorId: actor.userId,
      actorRole: actor.role,
      requestId: actor.requestId
    })
  );

  if (!result.ok) return failState(result);
  revalidatePath("/admin/users");
  return refreshScreen("/admin/users");
}

export async function setUserActiveAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const result = await runAction((actor) =>
    setUserActive(String(formData.get("userId") ?? ""), {
      active: String(formData.get("active")) === "true",
      version: Number(formData.get("version")),
      actorId: actor.userId,
      actorRole: actor.role,
      requestId: actor.requestId
    })
  );

  if (!result.ok) return failState(result);
  revalidatePath("/admin/users");
  return refreshScreen("/admin/users");
}

/**
 * The one action here that returns instead of navigating, because it has something to SAY:
 * the confirmation that every session of theirs is now dead and the password has to be
 * handed over out of band. A redirect would discard that state — and with it the effect in
 * `EditPersonForm` that clears the typed password out of the DOM.
 *
 * So no `revalidatePath` either: pairing it with a returned state is what hangs the
 * transition, and the state is the one that would never arrive. `/admin/users` is
 * `force-dynamic`, so there is no server cache for it to bust — the only staleness that
 * matters is this session's copy of the row, whose `version` this bumps, and `EditPersonForm`
 * settles that with a `router.refresh()` once the confirmation is on screen.
 */
export async function resetUserPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const result = await runAction((actor) =>
    resetUserPassword(String(formData.get("userId") ?? ""), {
      newPassword: String(formData.get("newPassword") ?? ""),
      version: Number(formData.get("version")),
      actorId: actor.userId,
      actorRole: actor.role,
      requestId: actor.requestId
    })
  );

  if (!result.ok) return failState(result);
  return {
    title: "Password reset",
    detail: "Every session they were signed in on has been signed out. Share the new password with them out of band.",
    success: true
  };
}
