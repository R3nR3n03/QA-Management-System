"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createExecution } from "@/domain/executions";
import { failState, runAction, type FormState } from "@/ui/action";

export async function createExecutionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const result = await runAction((actor) =>
    createExecution(
      {
        businessId: String(formData.get("businessId") ?? ""),
        // One checkbox per approved case; the domain enforces non-empty/no-duplicates.
        testCaseIds: formData.getAll("testCaseIds").map((value) => String(value)),
        testerId: String(formData.get("testerId") ?? "")
      },
      actor
    )
  );

  if (!result.ok) return failState(result);
  revalidatePath("/executions");
  revalidatePath("/my-work");
  redirect(`/executions/${result.data.id}`);
}
