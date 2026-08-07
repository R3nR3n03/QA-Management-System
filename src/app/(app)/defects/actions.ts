"use server";

import { DefectLifecycleState } from "@prisma/client";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createDefect, transitionDefect, updateDefectDetails } from "@/domain/defects";
import { failState, runAction, type FormState } from "@/ui/action";

/**
 * Server actions for the defect lifecycle. The transition table, the role gates and
 * every required-rationale rule live in `src/domain/defects.ts`; these read the form
 * and call one service each.
 *
 * Both edits then redirect to the defect they changed, for the reason set out on
 * `refreshScreen` in `src/ui/action.ts`: a revalidate-only action leaves the screen on its
 * pre-submit render, so a triaged defect kept reading New — with the button stuck mid-word
 * — until the viewer reloaded. Both forms live on the defect's own screen.
 */

function revalidateDefect(id: string) {
  revalidatePath(`/defects/${id}`);
  revalidatePath("/defects");
}

export async function createDefectAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const field = (name: string) => String(formData.get(name) ?? "");
  const result = await runAction((actor) =>
    createDefect(
      {
        // No businessId: the domain allocates the next free BUG-#### in the create tx.
        testCaseId: field("testCaseId"),
        summary: field("summary"),
        priority: field("priority") || undefined,
        severity: field("severity") || undefined
      },
      actor
    )
  );

  if (!result.ok) return failState(result);
  revalidateDefect(result.data.id);
  redirect(`/defects/${result.data.id}`);
}

export async function updateDefectAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get("defectId") ?? "");
  const field = (name: string) => String(formData.get(name) ?? "");

  const result = await runAction((actor) =>
    updateDefectDetails(
      id,
      {
        summary: field("summary"),
        priority: field("priority") || undefined,
        severity: field("severity") || undefined,
        version: Number(formData.get("version"))
      },
      actor
    )
  );

  if (!result.ok) return failState(result);
  revalidateDefect(id);
  redirect(`/defects/${id}`);
}

export async function transitionDefectAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get("defectId") ?? "");
  const field = (name: string) => String(formData.get(name) ?? "").trim();

  const result = await runAction((actor) =>
    transitionDefect(
      id,
      {
        version: Number(formData.get("version")),
        targetStatus: field("targetStatus") as DefectLifecycleState,
        investigationOwnerId: field("investigationOwnerId") || undefined,
        resolutionSummary: field("resolutionSummary") || undefined,
        retestEvidenceRef: field("retestEvidenceRef") || undefined,
        closureRationale: field("closureRationale") || undefined,
        reopenReason: field("reopenReason") || undefined
      },
      actor
    )
  );

  if (!result.ok) return failState(result);
  revalidateDefect(id);
  redirect(`/defects/${id}`);
}
