"use server";

import { revalidatePath } from "next/cache";
import { createRtmLink } from "@/domain/traceability";
import { failState, refreshScreen, runAction, type FormState } from "@/ui/action";

/**
 * A new trace link keeps the viewer on the RTM — the point of linking is to watch the gap
 * list shrink — so this ends in `refreshScreen` and not `return null`. A revalidate-only
 * action never commits its refresh, so the new link and the requirement it just covered
 * stayed invisible until a manual reload (see `src/ui/action.ts`). Returning to the
 * submitted URL keeps both pagers where they were.
 */
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
  return refreshScreen("/traceability");
}
