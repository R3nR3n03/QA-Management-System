"use server";

import { QamsRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { createUser, resetUserPassword, setUserActive, updateUserProfile, updateUserRole } from "@/domain/admin";
import { failState, runAction, type FormState } from "@/ui/action";

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
  return null;
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
  return null;
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
  return null;
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
  return null;
}

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
  revalidatePath("/admin/users");
  return {
    title: "Password reset",
    detail: "Every session they were signed in on has been signed out. Share the new password with them out of band.",
    success: true
  };
}
