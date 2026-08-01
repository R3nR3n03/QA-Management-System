"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { FormNotice } from "@/ui/notice";
import { Modal } from "@/ui/modal";
import { useToast } from "@/ui/toast";
import type { FormState } from "@/ui/action";
import { fieldClass, fieldProps, noticeId } from "@/ui/form";
import {
  createFeatureAction,
  createModuleAction,
  createProductAction,
  createRequirementAction
} from "./actions";

type Parent = { id: string; businessId: string; label: string };

/**
 * Catalogue creation, QA-Lead-gated in the domain. Each entity's "Add" opens a
 * modal (title, what it does, the form) instead of a permanently rendered card —
 * the list stays the screen's subject and entry happens in a focused layer. On
 * success the modal closes itself, the list revalidates, and a toast confirms;
 * on failure the inline notice names the field, exactly as before.
 */

function useSuccess(pending: boolean, state: FormState, onDone: () => void) {
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && state === null) onDone();
    wasPending.current = pending;
  }, [pending, state, onDone]);
}

const PRODUCT_FORM_ID = "add-product";

export function ProductForm({ onDone }: { onDone: () => void }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(createProductAction, null);
  useSuccess(pending, state, onDone);
  const bad = (field: string) => fieldClass(state, field);
  return (
    <form action={formAction}>
      <FormNotice state={state} id={noticeId(PRODUCT_FORM_ID)} />
      <div className="form-grid-2">
        <label className={bad("businessId")}>
          <span>Product ID</span>
          <input name="businessId" placeholder="PROD001" required disabled={pending} autoFocus {...fieldProps(state, "businessId", PRODUCT_FORM_ID)} />
          <span className="hint">Format PROD### — immutable once created.</span>
        </label>
        <label className={bad("name")}>
          <span>Name</span>
          <input name="name" required disabled={pending} {...fieldProps(state, "name", PRODUCT_FORM_ID)} />
        </label>
        <label className={bad("versionTag")}>
          <span>Version</span>
          <input name="versionTag" required disabled={pending} {...fieldProps(state, "versionTag", PRODUCT_FORM_ID)} />
        </label>
        <label className={bad("status")}>
          <span>Status</span>
          <input name="status" placeholder="Active" required disabled={pending} {...fieldProps(state, "status", PRODUCT_FORM_ID)} />
        </label>
      </div>
      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add product"}
      </button>
    </form>
  );
}

const CHILD_FORM_ID = "add-catalogue-child";

function ChildForm({
  action,
  idLabel,
  idPlaceholder,
  nameField,
  nameLabel,
  parentField,
  parentLabel,
  parents,
  submitLabel,
  onDone
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
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);
  useSuccess(pending, state, onDone);
  const bad = (field: string) => fieldClass(state, field);
  return (
    <form action={formAction}>
      <FormNotice state={state} id={noticeId(CHILD_FORM_ID)} />
      <label className={bad(parentField)}>
        <span>{parentLabel}</span>
        <select name={parentField} required defaultValue="" disabled={pending} autoFocus {...fieldProps(state, parentField, CHILD_FORM_ID)}>
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
      <div className="form-grid-2">
        <label className={bad("businessId")}>
          <span>{idLabel}</span>
          <input name="businessId" placeholder={idPlaceholder} required disabled={pending} {...fieldProps(state, "businessId", CHILD_FORM_ID)} />
        </label>
        <label className={bad(nameField)}>
          <span>{nameLabel}</span>
          <input name={nameField} required disabled={pending} {...fieldProps(state, nameField, CHILD_FORM_ID)} />
        </label>
      </div>
      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Adding…" : submitLabel}
      </button>
    </form>
  );
}

function AddModal({
  buttonLabel,
  title,
  description,
  toastMessage,
  children
}: {
  buttonLabel: string;
  title: string;
  description: string;
  toastMessage: string;
  children: (onDone: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const done = () => {
    setOpen(false);
    toast(toastMessage);
  };
  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
        <Plus size={14} aria-hidden style={{ verticalAlign: "-2px", marginRight: 6 }} />
        {buttonLabel}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} description={description}>
        {children(done)}
      </Modal>
    </>
  );
}

export function AddProductModal() {
  return (
    <AddModal
      buttonLabel="Add product"
      title="Add product"
      description="A new top-level product in the catalogue hierarchy."
      toastMessage="Product added."
    >
      {(onDone) => <ProductForm onDone={onDone} />}
    </AddModal>
  );
}

export function AddModuleModal({ products }: { products: Parent[] }) {
  return (
    <AddModal
      buttonLabel="Add module"
      title="Add module"
      description="A module inside one of the products."
      toastMessage="Module added."
    >
      {(onDone) => (
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
          onDone={onDone}
        />
      )}
    </AddModal>
  );
}

export function AddFeatureModal({ modules }: { modules: Parent[] }) {
  return (
    <AddModal
      buttonLabel="Add feature"
      title="Add feature"
      description="A feature inside one of the modules."
      toastMessage="Feature added."
    >
      {(onDone) => (
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
          onDone={onDone}
        />
      )}
    </AddModal>
  );
}

export function AddRequirementModal({ features }: { features: Parent[] }) {
  return (
    <AddModal
      buttonLabel="Add requirement"
      title="Add requirement"
      description="A requirement under one of the features."
      toastMessage="Requirement added."
    >
      {(onDone) => (
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
          onDone={onDone}
        />
      )}
    </AddModal>
  );
}
