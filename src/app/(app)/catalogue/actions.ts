"use server";

import { revalidatePath } from "next/cache";
import {
  createFeature,
  createModule,
  createProduct,
  createRequirement,
  updateFeature,
  updateModule,
  updateProduct,
  updateRequirement
} from "@/domain/catalogue";
import { failState, refreshScreen, runAction, type FormState } from "@/ui/action";

/**
 * Catalogue creation and editing, QA-Lead-gated in the domain services.
 *
 * Every one of these is submitted from the catalogue screen and leaves the viewer on it, so
 * each ends in `refreshScreen` rather than `return null`: a revalidate-only action never
 * commits its refresh, which left a renamed product reading its old name behind a button
 * stuck on "Saving…" (see `src/ui/action.ts`). `refreshScreen` returns to the URL the form
 * was submitted from, so the four lists keep the page each of them was on — the bare
 * `/catalogue` fallback would have paged them all back to the top.
 */

export async function createProductAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const field = (name: string) => String(formData.get(name) ?? "");
  const result = await runAction((actor) =>
    createProduct(
      { businessId: field("businessId"), name: field("name"), versionTag: field("versionTag"), status: field("status") },
      actor
    )
  );
  if (!result.ok) return failState(result);
  revalidatePath("/catalogue");
  return refreshScreen("/catalogue");
}

export async function createModuleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const field = (name: string) => String(formData.get(name) ?? "");
  const result = await runAction((actor) =>
    createModule({ businessId: field("businessId"), name: field("name"), productId: field("productId") }, actor)
  );
  if (!result.ok) return failState(result);
  revalidatePath("/catalogue");
  return refreshScreen("/catalogue");
}

export async function createFeatureAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const field = (name: string) => String(formData.get(name) ?? "");
  const result = await runAction((actor) =>
    createFeature({ businessId: field("businessId"), name: field("name"), moduleId: field("moduleId") }, actor)
  );
  if (!result.ok) return failState(result);
  revalidatePath("/catalogue");
  return refreshScreen("/catalogue");
}

export async function createRequirementAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const field = (name: string) => String(formData.get(name) ?? "");
  const result = await runAction((actor) =>
    createRequirement(
      { businessId: field("businessId"), statement: field("statement"), featureId: field("featureId") },
      actor
    )
  );
  if (!result.ok) return failState(result);
  revalidatePath("/catalogue");
  return refreshScreen("/catalogue");
}

// Edits carry the hidden id + version pair; a stale version surfaces as the
// VERSION_CONFLICT copy through failState. The business ID and the parent link are
// immutable — only the descriptive fields below are editable.

export async function updateProductAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const field = (name: string) => String(formData.get(name) ?? "");
  const result = await runAction((actor) =>
    updateProduct(
      field("id"),
      {
        name: field("name"),
        versionTag: field("versionTag"),
        status: field("status"),
        version: Number(formData.get("version"))
      },
      actor
    )
  );
  if (!result.ok) return failState(result);
  revalidatePath("/catalogue");
  return refreshScreen("/catalogue");
}

export async function updateModuleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const field = (name: string) => String(formData.get(name) ?? "");
  const result = await runAction((actor) =>
    updateModule(field("id"), { name: field("name"), version: Number(formData.get("version")) }, actor)
  );
  if (!result.ok) return failState(result);
  revalidatePath("/catalogue");
  return refreshScreen("/catalogue");
}

export async function updateFeatureAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const field = (name: string) => String(formData.get(name) ?? "");
  const result = await runAction((actor) =>
    updateFeature(field("id"), { name: field("name"), version: Number(formData.get("version")) }, actor)
  );
  if (!result.ok) return failState(result);
  revalidatePath("/catalogue");
  return refreshScreen("/catalogue");
}

export async function updateRequirementAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const field = (name: string) => String(formData.get(name) ?? "");
  const result = await runAction((actor) =>
    updateRequirement(
      field("id"),
      { statement: field("statement"), version: Number(formData.get("version")) },
      actor
    )
  );
  if (!result.ok) return failState(result);
  revalidatePath("/catalogue");
  return refreshScreen("/catalogue");
}
