"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createImportRun } from "@/domain/imports";
import { AppError } from "@/lib/errors";
import { assertWithinUploadLimit, maxUploadBytes } from "@/lib/upload-limits";
import { failState, runAction, type FormState } from "@/ui/action";
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
