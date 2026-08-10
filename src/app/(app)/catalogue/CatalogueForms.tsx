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
          <select name="status" defaultValue="Active" required disabled={pending} {...fieldProps(state, "status", PRODUCT_FORM_ID)}>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
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
  lockedParent,
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
  /**
   * Candidate parents, for the case where nothing has decided one.
   *
   * Empty in practice: `ContextualCreate` is the only caller and it always locks the
   * parent. It stays a supported shape because a dropdown is the right control if this
   * form is ever opened outside a selection — but nothing on this screen pays to fill it.
   * Filling it used to cost three unbounded table reads on every page load, feeding a
   * `<select>` that was never rendered.
   */
  parents?: Parent[];
  /**
   * The parent, when the explorer's selection already decided it. Adding a feature to
   * MOD004 should not open a dropdown of every module in the catalogue and ask which
   * one — the answer is on screen and already chosen. Stated as read-only text plus a
   * hidden input; the domain re-checks the parent exists either way.
   */
  lockedParent?: Parent;
  submitLabel: string;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);
  useSuccess(pending, state, onDone);
  const bad = (field: string) => fieldClass(state, field);
  return (
    <form action={formAction}>
      <FormNotice state={state} id={noticeId(CHILD_FORM_ID)} />
      {lockedParent ? (
        <>
          <input type="hidden" name={parentField} value={lockedParent.id} />
          <div className="field">
            <span>{parentLabel}</span>
            <p className="locked-parent">
              <span className="bid">{lockedParent.businessId}</span> {lockedParent.label}
            </p>
          </div>
        </>
      ) : (
        <label className={bad(parentField)}>
          <span>{parentLabel}</span>
          <select name={parentField} required defaultValue="" disabled={pending} autoFocus {...fieldProps(state, parentField, CHILD_FORM_ID)}>
            <option value="" disabled>
              Choose…
            </option>
            {(parents ?? []).map((parent) => (
              <option key={parent.id} value={parent.id}>
                {parent.businessId} · {parent.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="form-grid-2">
        <label className={bad("businessId")}>
          <span>{idLabel}</span>
          {/* Takes the focus when the parent select is not there to take it. */}
          <input name="businessId" placeholder={idPlaceholder} required disabled={pending} autoFocus={Boolean(lockedParent)} {...fieldProps(state, "businessId", CHILD_FORM_ID)} />
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
  primary = false,
  children
}: {
  buttonLabel: string;
  title: string;
  description: string;
  toastMessage: string;
  /** The screen's single call to action wears the filled treatment. */
  primary?: boolean;
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
      <button
        type="button"
        className={primary ? "btn" : "btn btn-secondary"}
        onClick={() => setOpen(true)}
      >
        <Plus size={14} aria-hidden style={{ verticalAlign: "-2px", marginRight: 6 }} />
        {buttonLabel}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} description={description}>
        {children(done)}
      </Modal>
    </>
  );
}

export function AddProductModal({ primary = false }: { primary?: boolean }) {
  return (
    <AddModal
      buttonLabel="New product"
      title="Add product"
      description="A new top-level product in the catalogue hierarchy."
      toastMessage="Product added."
      primary={primary}
    >
      {(onDone) => <ProductForm onDone={onDone} />}
    </AddModal>
  );
}

export function AddModuleModal({
  products,
  lockedParent,
  primary = false
}: {
  products?: Parent[];
  lockedParent?: Parent;
  primary?: boolean;
}) {
  return (
    <AddModal
      buttonLabel={lockedParent ? `Add module to ${lockedParent.businessId}` : "Add module"}
      title="Add module"
      description={
        lockedParent
          ? `A module inside ${lockedParent.businessId} ${lockedParent.label}.`
          : "A module inside one of the products."
      }
      toastMessage="Module added."
      primary={primary}
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
          lockedParent={lockedParent}
          submitLabel="Add module"
          onDone={onDone}
        />
      )}
    </AddModal>
  );
}

export function AddFeatureModal({
  modules,
  lockedParent,
  primary = false
}: {
  modules?: Parent[];
  lockedParent?: Parent;
  primary?: boolean;
}) {
  return (
    <AddModal
      buttonLabel={lockedParent ? `Add feature to ${lockedParent.businessId}` : "Add feature"}
      title="Add feature"
      description={
        lockedParent
          ? `A feature inside ${lockedParent.businessId} ${lockedParent.label}.`
          : "A feature inside one of the modules."
      }
      toastMessage="Feature added."
      primary={primary}
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
          lockedParent={lockedParent}
          submitLabel="Add feature"
          onDone={onDone}
        />
      )}
    </AddModal>
  );
}

export function AddRequirementModal({
  features,
  lockedParent,
  primary = false
}: {
  features?: Parent[];
  lockedParent?: Parent;
  primary?: boolean;
}) {
  return (
    <AddModal
      buttonLabel={lockedParent ? `Add requirement to ${lockedParent.businessId}` : "Add requirement"}
      title="Add requirement"
      description={
        lockedParent
          ? `A requirement under ${lockedParent.businessId} ${lockedParent.label}.`
          : "A requirement under one of the features."
      }
      toastMessage="Requirement added."
      primary={primary}
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
          lockedParent={lockedParent}
          submitLabel="Add requirement"
          onDone={onDone}
        />
      )}
    </AddModal>
  );
}

/**
 * The screen's one call to action. What it creates follows the selection: nothing
 * selected offers a product, a selected product offers a module inside it, and so on
 * down to a requirement.
 *
 * Four permanent Add buttons made the reader choose WHICH before choosing WHAT, and every
 * one of them then asked for a parent the screen already knew — a dropdown of every module
 * in the catalogue, to add a feature to the module you were looking at.
 */
export function ContextualCreate({
  selection
}: {
  selection: { kind: "product" | "module" | "feature"; parent: Parent } | null;
}) {
  if (selection === null) return <AddProductModal primary />;
  // No candidate lists: every branch below locks the parent, so the dropdown those lists
  // fed is never rendered. Fetching them cost three unbounded table reads on every load of
  // the screen — see `listProductOptions` in `src/domain/catalogue.ts`.
  if (selection.kind === "product") {
    return <AddModuleModal lockedParent={selection.parent} primary />;
  }
  if (selection.kind === "module") {
    return <AddFeatureModal lockedParent={selection.parent} primary />;
  }
  return <AddRequirementModal lockedParent={selection.parent} primary />;
}
