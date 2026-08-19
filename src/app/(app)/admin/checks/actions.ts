"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createCheckBatch } from "@/domain/checks";
import { AppError } from "@/lib/errors";
import { assertWithinUploadLimit, maxUploadBytes } from "@/lib/upload-limits";
import { failState, runAction, type FormState } from "@/ui/action";
import { errorCopy } from "@/ui/error-copy";

export async function uploadCheckResultsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    const copy = errorCopy("ID_INVALID", "file");
    return { title: copy.title, detail: "Choose a JUnit XML results file first.", field: "file" };
  }

  // The same size gate the API route applies, before the bytes are read out.
  try {
    assertWithinUploadLimit(file.size, maxUploadBytes(), "results file");
  } catch (error) {
    if (error instanceof AppError) {
      const copy = errorCopy(error.code, error.field);
      return { title: copy.title, detail: copy.detail, field: error.field };
    }
    throw error;
  }

  const xml = await file.text();
  const result = await runAction((actor) => createCheckBatch(actor, file.name, xml));

  if (!result.ok) return failState(result);
  revalidatePath("/admin/checks");
  redirect(`/admin/checks/${result.data.id}`);
}
