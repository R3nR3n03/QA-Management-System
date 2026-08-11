"use server";

import { ExecutionOutcome } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { finalizeExecution, startExecution, updateExecution } from "@/domain/executions";
import { failState, runAction, type FormState } from "@/ui/action";
import { readOptionalText } from "@/ui/form-data";

/**
 * Server actions for the execution lifecycle. Each one authenticates, calls exactly
 * one domain service, and returns — the same contract route handlers follow
 * (`docs/architecture.md:33`). No rule is re-implemented here: Fail-needs-a-defect,
 * Blocked-needs-a-reason, assigned-tester-only and the version check all live in
 * `src/domain/executions.ts` and are enforced there whichever caller asks.
 *
 * ## Why each one ends in a redirect to the run it just changed
 *
 * `revalidatePath` on its own left the screen showing its PRE-submit render: Finalize
 * stuck on "Finalizing…" with the run still reading In Progress, and the only way to see
 * the finalized record was a manual reload. The write had already committed — what never
 * happened was the client-side refresh the revalidation was supposed to trigger. A server
 * action that only revalidates does that refresh inside the action's own transition, and
 * that transition does not commit here (`vercel/next.js` discussion #82289, issue #66426 —
 * revalidate-only actions under a segment that has a `loading.tsx`, which `(app)` does).
 * `useActionState`'s pending flag is optimistic state tied to that transition, so it stays
 * true for as long as the transition hangs: the frozen button and the stale record are one
 * symptom, not two.
 *
 * Redirecting to the same URL completes the navigation the refresh was meant to be, and it
 * is the pattern every create action in this app already uses (`../new/actions.ts`,
 * `../../test-cases/actions.ts`) — the ones nobody has had to reload. The
 * `revalidatePath` calls stay: they are what makes the navigation fetch a fresh tree
 * instead of the client router's cached copy of the pre-transition one.
 *
 * `redirect()` signals by throwing, so it must be the last statement in each action and
 * must never sit inside a `try` — `runAction`'s catch is around the domain call only.
 */

export type { FormState } from "@/ui/action";

export async function startExecutionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get("executionId") ?? "");
  const version = Number(formData.get("version"));

  const result = await runAction((actor) => startExecution(id, version, actor));

  if (!result.ok) return failState(result);

  revalidatePath(`/executions/${id}`);
  revalidatePath("/my-work");
  redirect(`/executions/${id}`);
}

export async function updateExecutionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get("executionId") ?? "");
  const version = Number(formData.get("version"));
  const testerId = String(formData.get("testerId") ?? "");

  // Absent means "this form said nothing about Jira, leave the key alone"; present and
  // empty means "clear it". `updateExecution` distinguishes the two, which is why this is
  // not the usual `String(get(...) ?? "")`.
  const jiraIssueKey = readOptionalText(formData, "jiraIssueKey");

  /*
   * Deliberately NOT `readOptionalText`. That helper maps a cleared box to `null`, meaning
   * "remove the stored value" — right for the Jira key, wrong here, because a purpose is
   * required and so has no cleared state. Routed through it, emptying the box would send
   * `undefined` ("leave it alone") and the edit would be silently discarded: the form would
   * redirect looking successful while still showing the old purpose.
   *
   * So an absent field is still `undefined` ("this form said nothing about the purpose"),
   * but a submitted empty one travels as `""` and is refused by the domain with
   * 422 ID_INVALID naming the field.
   */
  const rawPurpose = formData.get("purpose");
  const purpose = typeof rawPurpose === "string" ? rawPurpose : undefined;

  const result = await runAction((actor) =>
    updateExecution(id, { testerId, version, purpose, jiraIssueKey }, actor)
  );

  if (!result.ok) return failState(result);

  revalidatePath(`/executions/${id}`);
  // Both queues change: the run leaves the old tester's My work and joins the new one's.
  revalidatePath("/my-work");
  redirect(`/executions/${id}`);
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
  // Finalizing also raises defects and closes the run, so the record the viewer lands on
  // is a different record than the one they submitted from — all the more reason this is a
  // navigation rather than a patch of the screen they were working in.
  redirect(`/executions/${id}`);
}
