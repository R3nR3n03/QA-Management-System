"use server";

import { revalidatePath } from "next/cache";
import {
  createFeature,
  createModule,
  createProduct,
  createRequirement,
  searchFeatures,
  updateFeature,
  updateModule,
  updateProduct,
  updateRequirement,
  type FeatureChoice
} from "@/domain/catalogue";
import { requireSession } from "@/ui/session";
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
 *
 * ## Why the creates no longer send `businessId`
 *
 * The forms stopped offering the field: `docs/data-model.md:5` has the system allocate an ID
 * when the request does not supply one. The key has to be OMITTED, not sent empty —
 * `suppliedBusinessId` in the domain treats `undefined` as "allocate" and `""` as a blank
 * input to reject, and `String(formData.get(…) ?? "")` would have turned an absent field into
 * exactly the rejected case. Hence `optionalField` rather than `field` for this one key.
 */

/**
 * A form value that is allowed to be absent. Returns `undefined` for a missing OR blank
 * field, so an omitted input and an emptied one both reach the domain as "not supplied".
 *
 * Only correct for `businessId`, where absent means "generate one". Every other field on
 * these forms is required, and `field` keeps sending `""` for those so the domain's own
 * non-blank check produces the error naming the field.
 */
function optionalField(formData: FormData, name: string): string | undefined {
  const raw = formData.get(name);
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  return raw;
}

/**
 * Features matching what the picker's box currently holds.
 *
 * A server action used as a READ, which is unusual here — every other action on this screen
 * mutates. The alternative was widening `GET /api/v1/features` with a `?q=`, and that is a
 * public API contract change for one dialog's convenience. This keeps the read behind the
 * domain layer (`docs/architecture.md:33`) and adds no route.
 *
 * `requireSession` and nothing more. Feature names and IDs are already visible to every
 * authenticated role through the executions and defects filters, so this exposes no record a
 * caller could not already list — and gating it to `canWriteRequirements` would be gating a
 * read on a write capability. The create it feeds is gated in the domain, which is where the
 * permission belongs.
 */
export async function searchFeaturesAction(needle: string): Promise<FeatureChoice[]> {
  await requireSession();
  return searchFeatures(needle);
}

export async function createProductAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const field = (name: string) => String(formData.get(name) ?? "");
  const result = await runAction((actor) =>
    createProduct(
      {
        businessId: optionalField(formData, "businessId"),
        name: field("name"),
        versionTag: field("versionTag"),
        status: field("status")
      },
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
    createModule(
      {
        businessId: optionalField(formData, "businessId"),
        name: field("name"),
        productId: field("productId")
      },
      actor
    )
  );
  if (!result.ok) return failState(result);
  revalidatePath("/catalogue");
  return refreshScreen("/catalogue");
}

export async function createFeatureAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const field = (name: string) => String(formData.get(name) ?? "");
  const result = await runAction((actor) =>
    createFeature(
      {
        businessId: optionalField(formData, "businessId"),
        name: field("name"),
        moduleId: field("moduleId")
      },
      actor
    )
  );
  if (!result.ok) return failState(result);
  revalidatePath("/catalogue");
  return refreshScreen("/catalogue");
}

export async function createRequirementAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const field = (name: string) => String(formData.get(name) ?? "");
  const result = await runAction((actor) =>
    createRequirement(
      {
        businessId: optionalField(formData, "businessId"),
        statement: field("statement"),
        featureId: field("featureId")
      },
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
