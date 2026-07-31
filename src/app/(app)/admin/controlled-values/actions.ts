"use server";

import { revalidatePath } from "next/cache";
import { updateControlledValue } from "@/domain/admin";
import { failState, runAction, type FormState } from "@/ui/action";

export async function toggleControlledValueAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const result = await runAction((actor) =>
    updateControlledValue(String(formData.get("id") ?? ""), {
      active: String(formData.get("active")) === "true",
      version: Number(formData.get("version")),
      actorId: actor.userId,
      actorRole: actor.role,
      requestId: actor.requestId
    })
  );

  if (!result.ok) return failState(result);
  revalidatePath("/admin/controlled-values");
  return null;
}
