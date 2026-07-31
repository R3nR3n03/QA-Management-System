"use server";

import { revalidatePath } from "next/cache";
import { createFeature, createModule, createProduct, createRequirement } from "@/domain/catalogue";
import { failState, runAction, type FormState } from "@/ui/action";

/** Catalogue creation, QA-Lead-gated in the domain services. */

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
  return null;
}

export async function createModuleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const field = (name: string) => String(formData.get(name) ?? "");
  const result = await runAction((actor) =>
    createModule({ businessId: field("businessId"), name: field("name"), productId: field("productId") }, actor)
  );
  if (!result.ok) return failState(result);
  revalidatePath("/catalogue");
  return null;
}

export async function createFeatureAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const field = (name: string) => String(formData.get(name) ?? "");
  const result = await runAction((actor) =>
    createFeature({ businessId: field("businessId"), name: field("name"), moduleId: field("moduleId") }, actor)
  );
  if (!result.ok) return failState(result);
  revalidatePath("/catalogue");
  return null;
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
  return null;
}
