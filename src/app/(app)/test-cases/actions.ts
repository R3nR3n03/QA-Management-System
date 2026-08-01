"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  approveTestCase,
  createTestCase,
  replaceSteps,
  retireTestCase,
  returnTestCaseToDraft,
  submitTestCase,
  updateTestCaseDraft
} from "@/domain/test-cases";
import { failState, runAction, type FormState } from "@/ui/action";

/**
 * Server actions for the test-case lifecycle. Same contract as the API routes
 * (`docs/architecture.md:33`): read the form, call ONE domain service, revalidate.
 * Every rule — author-only submit, reviewer-not-author approve, Draft-only edits,
 * step sequencing — lives in `src/domain/test-cases.ts` and is enforced there for
 * screen and API alike.
 */

function revalidateCase(id: string) {
  revalidatePath(`/test-cases/${id}`);
  revalidatePath("/test-cases");
  revalidatePath("/my-work/drafts");
  revalidatePath("/review");
}

export async function createTestCaseAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const field = (name: string) => String(formData.get(name) ?? "");
  const revises = field("revisesTestCaseId").trim();

  const result = await runAction((actor) =>
    createTestCase(
      {
        // No businessId: the domain allocates the next free TC-<PRODUCT>-#### for the
        // chosen product inside the create transaction.
        productId: field("productId"),
        moduleId: field("moduleId"),
        featureId: field("featureId"),
        requirementId: field("requirementId"),
        cycle: field("cycle"),
        sprint: field("sprint"),
        release: field("release"),
        environment: field("environment"),
        priority: field("priority"),
        severity: field("severity"),
        title: field("title"),
        objective: field("objective"),
        expectedResult: field("expectedResult"),
        revisesTestCaseId: revises || undefined
      },
      actor
    )
  );

  if (!result.ok) return failState(result);
  revalidateCase(result.data.id);
  redirect(`/test-cases/${result.data.id}`);
}

export async function updateDraftAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get("testCaseId") ?? "");
  const field = (name: string) => String(formData.get(name) ?? "");

  const result = await runAction((actor) =>
    updateTestCaseDraft(
      id,
      {
        cycle: field("cycle"),
        sprint: field("sprint"),
        release: field("release"),
        environment: field("environment"),
        priority: field("priority"),
        severity: field("severity"),
        title: field("title"),
        objective: field("objective"),
        expectedResult: field("expectedResult"),
        version: Number(formData.get("version"))
      },
      actor
    )
  );

  if (!result.ok) return failState(result);
  revalidateCase(id);
  return null;
}

export async function replaceStepsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get("testCaseId") ?? "");
  const version = Number(formData.get("version"));

  // Rows arrive as parallel field lists; sequencing validity is the domain's call.
  const actions = formData.getAll("stepAction").map(String);
  const expected = formData.getAll("stepExpected").map(String);
  const steps = actions
    .map((action, index) => ({ sequence: index + 1, action, expectedResult: expected[index] ?? "" }))
    .filter((step) => step.action.trim() || step.expectedResult.trim());

  const result = await runAction((actor) => replaceSteps(id, steps, version, actor));

  if (!result.ok) return failState(result);
  revalidateCase(id);
  return null;
}

export async function submitTestCaseAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get("testCaseId") ?? "");
  const result = await runAction((actor) => submitTestCase(id, Number(formData.get("version")), actor));
  if (!result.ok) return failState(result);
  revalidateCase(id);
  return null;
}

export async function approveTestCaseAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get("testCaseId") ?? "");
  const result = await runAction((actor) => approveTestCase(id, Number(formData.get("version")), actor));
  if (!result.ok) return failState(result);
  revalidateCase(id);
  return null;
}

export async function returnToDraftAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get("testCaseId") ?? "");
  const result = await runAction((actor) =>
    returnTestCaseToDraft(
      id,
      { version: Number(formData.get("version")), reviewReason: String(formData.get("reviewReason") ?? "") },
      actor
    )
  );
  if (!result.ok) return failState(result);
  revalidateCase(id);
  return null;
}

export async function retireTestCaseAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get("testCaseId") ?? "");
  const result = await runAction((actor) =>
    retireTestCase(
      id,
      { version: Number(formData.get("version")), retirementReason: String(formData.get("retirementReason") ?? "") },
      actor
    )
  );
  if (!result.ok) return failState(result);
  revalidateCase(id);
  return null;
}
