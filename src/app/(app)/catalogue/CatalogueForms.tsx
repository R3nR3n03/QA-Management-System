"use client";

import { useActionState } from "react";
import { FormNotice } from "@/ui/notice";
import type { FormState } from "@/ui/action";
import {
  createFeatureAction,
  createModuleAction,
  createProductAction,
  createRequirementAction
} from "./actions";

type Parent = { id: string; businessId: string; label: string };

export function ProductForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(createProductAction, null);
  const bad = (field: string) => (state?.field === field ? "field field-bad" : "field");
  return (
    <form action={formAction}>
      <FormNotice state={state} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0 var(--sp-3)" }}>
        <label className={bad("businessId")}>
          <span>Product ID</span>
          <input name="businessId" placeholder="PROD001" required disabled={pending} />
        </label>
        <label className={bad("name")}>
          <span>Name</span>
          <input name="name" required disabled={pending} />
        </label>
        <label className={bad("versionTag")}>
          <span>Version</span>
          <input name="versionTag" required disabled={pending} />
        </label>
        <label className={bad("status")}>
          <span>Status</span>
          <input name="status" placeholder="Active" required disabled={pending} />
        </label>
      </div>
      <button className="btn btn-secondary" type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add product"}
      </button>
    </form>
  );
}

function ChildForm({
  action,
  idLabel,
  idPlaceholder,
  nameField,
  nameLabel,
  parentField,
  parentLabel,
  parents,
  submitLabel
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  idLabel: string;
  idPlaceholder: string;
  nameField: string;
  nameLabel: string;
  parentField: string;
  parentLabel: string;
  parents: Parent[];
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);
  const bad = (field: string) => (state?.field === field ? "field field-bad" : "field");
  return (
    <form action={formAction}>
      <FormNotice state={state} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0 var(--sp-3)" }}>
        <label className={bad("businessId")}>
          <span>{idLabel}</span>
          <input name="businessId" placeholder={idPlaceholder} required disabled={pending} />
        </label>
        <label className={bad(nameField)}>
          <span>{nameLabel}</span>
          <input name={nameField} required disabled={pending} />
        </label>
        <label className={bad(parentField)}>
          <span>{parentLabel}</span>
          <select name={parentField} required defaultValue="" disabled={pending}>
            <option value="" disabled>
              Choose…
            </option>
            {parents.map((parent) => (
              <option key={parent.id} value={parent.id}>
                {parent.businessId} · {parent.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button className="btn btn-secondary" type="submit" disabled={pending}>
        {pending ? "Adding…" : submitLabel}
      </button>
    </form>
  );
}

export function ModuleForm({ products }: { products: Parent[] }) {
  return (
    <ChildForm
      action={createModuleAction}
      idLabel="Module ID"
      idPlaceholder="MOD001"
      nameField="name"
      nameLabel="Name"
      parentField="productId"
      parentLabel="Product"
      parents={products}
      submitLabel="Add module"
    />
  );
}

export function FeatureForm({ modules }: { modules: Parent[] }) {
  return (
    <ChildForm
      action={createFeatureAction}
      idLabel="Feature ID"
      idPlaceholder="FEAT001"
      nameField="name"
      nameLabel="Name"
      parentField="moduleId"
      parentLabel="Module"
      parents={modules}
      submitLabel="Add feature"
    />
  );
}

export function RequirementForm({ features }: { features: Parent[] }) {
  return (
    <ChildForm
      action={createRequirementAction}
      idLabel="Requirement ID"
      idPlaceholder="REQ001"
      nameField="statement"
      nameLabel="Statement"
      parentField="featureId"
      parentLabel="Feature"
      parents={features}
      submitLabel="Add requirement"
    />
  );
}
