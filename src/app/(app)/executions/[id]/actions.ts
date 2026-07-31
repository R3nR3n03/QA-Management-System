"use server";

import { ExecutionOutcome } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { finalizeExecution, startExecution, updateExecution } from "@/domain/executions";
import { runAction } from "@/ui/action";

/**
 * Server actions for the execution lifecycle. Each one authenticates, calls exactly
 * one domain service, and returns — the same contract route handlers follow
 * (`docs/architecture.md:33`). No rule is re-implemented here: Fail-needs-a-defect,
 * Blocked-needs-a-reason, assigned-tester-only and the version check all live in
 * `src/domain/executions.ts` and are enforced there whichever caller asks.
 */

export type FormState = {
  title: string;
  detail: string;
  field?: string;
  requestId?: string;
  advisory?: boolean;
} | null;

export async function startExecutionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get("executionId") ?? "");
  const version = Number(formData.get("version"));

  const result = await runAction((actor) => startExecution(id, version, actor));

  if (!result.ok) {
    return {
      title: result.copy.title,
      detail: result.copy.detail,
      field: result.field,
      requestId: result.code === "INTERNAL_ERROR" ? result.requestId : undefined,
      advisory: result.copy.advisory
    };
  }

  revalidatePath(`/executions/${id}`);
  revalidatePath("/my-work");
  return null;
}

export async function updateExecutionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get("executionId") ?? "");
  const version = Number(formData.get("version"));
  const testerId = String(formData.get("testerId") ?? "");

  const result = await runAction((actor) => updateExecution(id, { testerId, version }, actor));

  if (!result.ok) {
    return {
      title: result.copy.title,
      detail: result.copy.detail,
      field: result.field,
      requestId: result.code === "INTERNAL_ERROR" ? result.requestId : undefined,
      advisory: result.copy.advisory
    };
  }

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
  const outcome = String(formData.get("result") ?? "") as ExecutionOutcome;
  const actualResult = String(formData.get("actualResult") ?? "");
  const blockReason = String(formData.get("blockReason") ?? "");
  const defectBusinessId = String(formData.get("defectBusinessId") ?? "").trim();
  const defectSummary = String(formData.get("defectSummary") ?? "").trim();
  const defectPriority = String(formData.get("defectPriority") ?? "").trim();
  const defectSeverity = String(formData.get("defectSeverity") ?? "").trim();

  // Shape only. Whether a Fail actually requires a defect, and whether these values
  // are acceptable, is decided by finalizeExecution — not here.
  const createDefect =
    outcome === ExecutionOutcome.FAIL && defectBusinessId
      ? {
          businessId: defectBusinessId,
          summary: defectSummary,
          priority: defectPriority || undefined,
          severity: defectSeverity || undefined
        }
      : undefined;

  const result = await runAction((actor) =>
    finalizeExecution(
      id,
      {
        version,
        result: outcome,
        actualResult,
        blockReason: blockReason || undefined,
        createDefect
      },
      actor
    )
  );

  if (!result.ok) {
    return {
      title: result.copy.title,
      detail: result.copy.detail,
      field: result.field,
      requestId: result.code === "INTERNAL_ERROR" ? result.requestId : undefined,
      advisory: result.copy.advisory
    };
  }

  revalidatePath(`/executions/${id}`);
  revalidatePath("/my-work");
  return null;
}
