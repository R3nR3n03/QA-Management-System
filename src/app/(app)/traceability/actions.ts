"use server";

import { revalidatePath } from "next/cache";
import { createRtmLink } from "@/domain/traceability";
import { failState, runAction, type FormState } from "@/ui/action";

export async function createRtmLinkAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const defectId = String(formData.get("defectId") ?? "").trim();
  const result = await runAction((actor) =>
    createRtmLink({
      requirementId: String(formData.get("requirementId") ?? ""),
      testCaseId: String(formData.get("testCaseId") ?? ""),
      defectId: defectId || undefined,
      actorId: actor.userId,
      actorRole: actor.role,
      requestId: actor.requestId
    })
  );

  if (!result.ok) return failState(result);
  revalidatePath("/traceability");
  return null;
}
