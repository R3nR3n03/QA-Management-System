"use server";

import { QamsRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { createUser, setUserActive, updateUserProfile, updateUserRole } from "@/domain/admin";
import { failState, refreshScreen, runAction, type FormState } from "@/ui/action";

/**
 * People administration. Every form is on the People screen and leaves the viewer there, so
 * each action ends in `refreshScreen`: a revalidate-only action never commits its refresh,
 * so a role change or a deactivation stayed off screen until a manual reload — and a role
 * change that appears not to have happened is the kind of thing an administrator does twice
 * (see `src/ui/action.ts`). Returning to the submitted URL keeps the page and rows-per-page
 * the list was showing.
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
