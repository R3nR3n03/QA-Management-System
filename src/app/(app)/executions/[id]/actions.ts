"use server";

import { ExecutionOutcome } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { finalizeExecution, startExecution, updateExecution } from "@/domain/executions";
import { failState, runAction, type FormState } from "@/ui/action";

/**
 * Server actions for the execution lifecycle. Each one authenticates, calls exactly
 * one domain service, and returns — the same contract route handlers follow
 * (`docs/architecture.md:33`). No rule is re-implemented here: Fail-needs-a-defect,
 * Blocked-needs-a-reason, assigned-tester-only and the version check all live in
 * `src/domain/executions.ts` and are enforced there whichever caller asks.
 */

export type { FormState } from "@/ui/action";

export async function startExecutionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get("executionId") ?? "");
  const version = Number(formData.get("version"));

  const result = await runAction((actor) => startExecution(id, version, actor));

  if (!result.ok) return failState(result);

  revalidatePath(`/executions/${id}`);
  revalidatePath("/my-work");
  return null;
}

export async function updateExecutionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get("executionId") ?? "");
  const version = Number(formData.get("version"));
  const testerId = String(formData.get("testerId") ?? "");

  const result = await runAction((actor) => updateExecution(id, { testerId, version }, actor));

  if (!result.ok) return failState(result);

  revalidatePath(`/executions/${id}`);
  // Both queues change: the run leaves the old tester's My work and joins the new one's.
  revalidatePath("/my-work");
  return null;
}

export async function finalizeExecutionAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const id = String(formData.get("executionId") ?? "");
  const version = Number(formData.get("version"));

  // One result entry per covered case, in the order the form rendered them (the
  // hidden `caseIds` inputs). Shape only: whether the set covers the execution's
  // cases, whether a Fail actually requires a defect, and whether these values are
  // acceptable, is decided by finalizeExecution — not here.
  const results = formData.getAll("caseIds").map((rawCaseId) => {
    const testCaseId = String(rawCaseId);
    const outcome = String(formData.get(`result:${testCaseId}`) ?? "") as ExecutionOutcome;
    const blockReason = String(formData.get(`blockReason:${testCaseId}`) ?? "");
    const defectId = String(formData.get(`defectId:${testCaseId}`) ?? "").trim();
    const defectSummary = String(formData.get(`defectSummary:${testCaseId}`) ?? "").trim();
    const defectPriority = String(formData.get(`defectPriority:${testCaseId}`) ?? "").trim();
    const defectSeverity = String(formData.get(`defectSeverity:${testCaseId}`) ?? "").trim();

    // A filled summary is what asks for a new defect — its BUG-#### is allocated by
    // the finalize transaction, so no ID travels from the form.
    const createDefect =
      outcome === ExecutionOutcome.FAIL && defectSummary
        ? {
            summary: defectSummary,
            priority: defectPriority || undefined,
            severity: defectSeverity || undefined
          }
        : undefined;

    return {
      testCaseId,
      result: outcome,
      actualResult: String(formData.get(`actualResult:${testCaseId}`) ?? ""),
      blockReason: blockReason || undefined,
      defectId: defectId || undefined,
      createDefect
    };
  });

  const result = await runAction((actor) => finalizeExecution(id, { version, results }, actor));

  if (!result.ok) return failState(result);

  revalidatePath(`/executions/${id}`);
  revalidatePath("/my-work");
  return null;
}
