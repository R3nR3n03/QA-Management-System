"use server";

import { revalidatePath } from "next/cache";
import { createControlledValue, updateControlledValue } from "@/domain/admin";
import type { ControlledCatalogue } from "@/lib/controlled-value-catalogues";
import { failState, runAction, type FormState } from "@/ui/action";

export async function createControlledValueAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const result = await runAction((actor) =>
    createControlledValue({
      // Shape only — an unknown catalogue is refused by the select below and, for any
      // other caller, by the API schema; the domain owns the duplicate and blank rules.
      catalogue: String(formData.get("catalogue") ?? "") as ControlledCatalogue,
      value: String(formData.get("value") ?? ""),
      actorId: actor.userId,
      actorRole: actor.role,
      requestId: actor.requestId
    })
  );

  if (!result.ok) return failState(result);
  revalidatePath("/admin/controlled-values");
  return null;
}

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
