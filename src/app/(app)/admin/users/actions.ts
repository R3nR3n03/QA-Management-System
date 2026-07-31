"use server";

import { QamsRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { updateUserRole } from "@/domain/admin";
import { failState, runAction, type FormState } from "@/ui/action";

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
