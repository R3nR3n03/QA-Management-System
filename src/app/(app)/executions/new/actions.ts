"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createExecution } from "@/domain/executions";
import { failState, runAction, type FormState } from "@/ui/action";
import { readOptionalText } from "@/ui/form-data";

export async function createExecutionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const result = await runAction((actor) =>
    createExecution(
      {
        // No businessId: the domain allocates the next free EXE-#### in the create
        // transaction (`docs/business-rules-and-validation.md:11`).
        // One checkbox per approved case; the domain enforces non-empty/no-duplicates.
        testCaseIds: formData.getAll("testCaseIds").map((value) => String(value)),
        testerId: String(formData.get("testerId") ?? ""),
        // Optional: a run need not test a Jira task. Left blank it stays null and the
        // execution never talks to Jira; a malformed key is refused by the domain with
        // 422 ID_INVALID rather than being silently dropped here.
        jiraIssueKey: readOptionalText(formData, "jiraIssueKey")
      },
      actor
    )
  );

  if (!result.ok) return failState(result);
  revalidatePath("/executions");
  revalidatePath("/my-work");
  redirect(`/executions/${result.data.id}`);
}
