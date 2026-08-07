"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createImportRun, resolveImportRow } from "@/domain/imports";
import { AppError } from "@/lib/errors";
import { assertWithinUploadLimit, maxUploadBytes } from "@/lib/upload-limits";
import { failState, refreshScreen, runAction, type FormState } from "@/ui/action";
import { errorCopy } from "@/ui/error-copy";

export async function uploadWorkbookAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    const copy = errorCopy("ID_INVALID", "file");
    return { title: copy.title, detail: "Choose a workbook file first.", field: "file" };
  }

  // The same A2 gate the API route applies, before the bytes are copied out.
  try {
    assertWithinUploadLimit(file.size, maxUploadBytes());
  } catch (error) {
    if (error instanceof AppError) {
      const copy = errorCopy(error.code, error.field);
      return { title: copy.title, detail: copy.detail, field: error.field };
    }
    throw error;
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const result = await runAction((actor) => createImportRun(actor, file.name, bytes));

  if (!result.ok) return failState(result);
  revalidatePath("/admin/imports");
  redirect(`/admin/imports/${result.data.id}`);
}

export async function resolveImportRowAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const rowReportId = String(formData.get("rowReportId") ?? "").trim();
  const decision = String(formData.get("decision") ?? "").trim();
  const rationale = String(formData.get("rationale") ?? "").trim();

  if (!rowReportId) return { title: "Import row missing", detail: "Choose a reconciliation row first.", field: "rowReportId" };
  if (decision !== "KEEP_CURRENT" && decision !== "ACCEPT_SOURCE") {
    return { title: "Invalid decision", detail: "Choose a valid reconciliation decision.", field: "decision" };
  }

  const result = await runAction((actor) => resolveImportRow(rowReportId, { decision, rationale }, actor));
  if (!result.ok) return failState(result);

  const runId = String(formData.get("runId") ?? "");
  revalidatePath(`/admin/imports/${runId}`);
  // Back to the run's report, where the row that was just reconciled has to change state —
  // a revalidate-only action never commits that refresh (see `src/ui/action.ts`), and on a
  // long report the viewer's place in the row list is worth keeping.
  return refreshScreen(`/admin/imports/${runId}`);
}
