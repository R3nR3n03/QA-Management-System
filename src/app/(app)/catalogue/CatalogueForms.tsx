"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { FormNotice } from "@/ui/notice";
import { Modal } from "@/ui/modal";
import { useToast } from "@/ui/toast";
import type { FormState } from "@/ui/action";
import { fieldClass, fieldProps, noticeId } from "@/ui/form";
import { Picker, type PickerOption } from "@/ui/picker";
import {
  createFeatureAction,
  createModuleAction,
  createProductAction,
  createRequirementAction,
  searchFeaturesAction
} from "./actions";

type Parent = { id: string; businessId: string; label: string };

/**
 * A feature search in the picker's row shape. The domain keeps returning `FeatureChoice`,
 * because the ancestry it assembles is a catalogue concern rather than a control's: the path
 * is what tells two identically named features apart, and dropping it here would file the
 * requirement under the wrong one.
 */
async function searchFeatureOptions(needle: string): Promise<PickerOption[]> {
  const choices = await searchFeaturesAction(needle);
  return choices.map((choice) => ({
    value: choice.id,
    code: choice.businessId,
    label: choice.name,
    hint: choice.path
  }));
}

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
        {/* No Product ID field — see the note in ChildForm. */}
        <label className={bad("name")}>
          <span>Name</span>
          <input name="name" required disabled={pending} autoFocus {...fieldProps(state, "name", PRODUCT_FORM_ID)} />
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
        {/* The one optional field on this form. Empty is the default and the safe direction:
            a new product raises nothing in Jira until someone says where its bugs go. */}
        <label className={bad("jiraProjectKey")}>
          <span>Jira project key</span>
          <input
            name="jiraProjectKey"
            disabled={pending}
            placeholder="Optional"
            {...fieldProps(state, "jiraProjectKey", PRODUCT_FORM_ID)}
          />
        </label>
      </div>
      <p className="hint">
        Defects against this product are raised as bugs in that Jira project, for example SP.
        Leave it empty to raise none; it can be set later.
      </p>
      <p className="hint id-hint">Product ID is assigned automatically, in the format PROD###.</p>
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
  parentPicker,
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
  /**
   * Search for the parent instead of selecting it from a list. Only `"feature"` exists,
   * because requirements are the level whose parent is worth searching for: a feature is
   * reached through two levels of tree, and there can be hundreds of them.
   */
  parentPicker?: "feature";
  submitLabel: string;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);
  useSuccess(pending, state, onDone);
  const bad = (field: string) => fieldClass(state, field);
  return (
    <form action={formAction}>
      <FormNotice state={state} id={noticeId(CHILD_FORM_ID)} />
      {parentPicker && !lockedParent ? (
        <Picker
          name={parentField}
          label={parentLabel}
          search={searchFeatureOptions}
          placeholder="Search features by ID or name…"
          disabled={pending}
          autoFocus
          aria-required
          {...fieldProps(state, parentField, CHILD_FORM_ID)}
        />
      ) : lockedParent ? (
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
      {/* No business-ID field. The form omits `businessId` entirely, which is the request
          to generate one (`docs/data-model.md:5`); the ID appears on the record afterwards.
          A supplied ID is still honoured by the service and by `POST /api/v1/…`, which is
          what the workbook import uses — but offering the field here would invite a
          hand-picked number that collides with the counter and leaves the allocator probing
          past it. `bad("businessId")` is deliberately still reachable: a duplicate or
          exhausted space comes back as a `businessId` error with no field to attach it to,
          so `FormNotice` above carries it. */}
      <label className={bad(nameField)}>
        <span>{nameLabel}</span>
        {/* Takes the focus when the parent control is not there to take it. */}
        <input name={nameField} required disabled={pending} autoFocus={Boolean(lockedParent)} {...fieldProps(state, nameField, CHILD_FORM_ID)} />
      </label>
      <p className="hint id-hint">{idLabel} is assigned automatically, in the format {idPlaceholder.replace(/\d/g, "#")}.</p>
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
  alsoOffer,
  children
}: {
  buttonLabel: string;
  title: string;
  description: string;
  toastMessage: string;
  /** The screen's single call to action wears the filled treatment. */
  primary?: boolean;
  /**
   * Levels this button is not the default for, revealed behind a caret. See
   * `ContextualCreate` for why the caret exists at all.
   */
  alsoOffer?: React.ReactNode;
  children: (onDone: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const done = () => {
    setOpen(false);
    toast(toastMessage);
  };
  const trigger = (
    <button
      type="button"
      className={primary ? "btn" : "btn btn-secondary"}
      onClick={() => setOpen(true)}
    >
      <Plus size={14} aria-hidden style={{ verticalAlign: "-2px", marginRight: 6 }} />
      {buttonLabel}
    </button>
  );

  return (
    <>
      {alsoOffer ? <SplitButton trigger={trigger} menu={alsoOffer} /> : trigger}
      <Modal open={open} onClose={() => setOpen(false)} title={title} description={description}>
        {children(done)}
      </Modal>
    </>
  );
}

/**
 * A default action with a caret holding the rest.
 *
 * Not a `<select>` and not a nav menu: each item in the panel is another `AddModal`'s own
 * trigger button, so opening one is the same code path as clicking it when it is the default.
 * That is what keeps "one call to action" true — there is one control, and the alternatives
 * live inside it rather than beside it.
 *
 * Escape closes and returns focus to the caret; a pointer press outside closes it. Both are
 * hand-rolled because this is a disclosure of two buttons, not a `<dialog>` — `Modal` already
 * owns focus trapping for the layer this opens.
 */
function SplitButton({ trigger, menu }: { trigger: React.ReactNode; menu: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const caret = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // Only ours: once a modal is open it owns Escape, and closing this panel underneath
      // would leave the dialog up with its opener gone.
      if (document.querySelector("dialog[open]")) return;
      setOpen(false);
      caret.current?.focus();
    }
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && wrap.current?.contains(event.target)) return;
      setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div className="split-btn" ref={wrap}>
      {trigger}
      <button
        type="button"
        ref={caret}
        className="btn split-btn-caret"
        aria-expanded={open}
        aria-label="More things to add"
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronDown size={14} aria-hidden />
      </button>
      {/* Left in the DOM only while open: a hidden panel of buttons is a set of tab stops that
          lead nowhere.

          It must NOT close itself when an item is clicked. Each item is a whole `AddModal` —
          its trigger AND its `<Modal>`, which `src/ui/modal.tsx` renders inline rather than
          through a portal. Closing on the bubbled click unmounted this branch in the same
          batch as the item's own `setOpen(true)`, destroying the state that had just been set
          (and running Modal's cleanup, which calls `close()`), so the caret's items opened
          nothing at all. Keeping the panel mounted is what lets the dialog exist.

          The dialog is a DOM descendant of the wrapper, so the outside-pointerdown handler
          above does not treat interacting with it as an outside press either. The panel is
          then dismissed the way it was opened — Escape or a press outside — once the dialog
          it launched has gone. */}
      {open ? <div className="split-btn-menu">{menu}</div> : null}
    </div>
  );
}

export function AddProductModal({
  primary = false,
  alsoOffer
}: {
  primary?: boolean;
  alsoOffer?: React.ReactNode;
}) {
  return (
    <AddModal
      buttonLabel="New product"
      title="Add product"
      description="A new top-level product in the catalogue hierarchy."
      toastMessage="Product added."
      primary={primary}
      alsoOffer={alsoOffer}
    >
      {(onDone) => <ProductForm onDone={onDone} />}
    </AddModal>
  );
}

export function AddModuleModal({
  products,
  lockedParent,
  primary = false,
  alsoOffer
}: {
  products?: Parent[];
  lockedParent?: Parent;
  primary?: boolean;
  alsoOffer?: React.ReactNode;
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
      alsoOffer={alsoOffer}
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
  primary = false,
  alsoOffer
}: {
  modules?: Parent[];
  lockedParent?: Parent;
  primary?: boolean;
  alsoOffer?: React.ReactNode;
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
      alsoOffer={alsoOffer}
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
          /* The one form whose parent can be chosen here rather than navigated to. With no
             selection the tree has not named a feature, so instead of the `<select>` of every
             feature that `parents` would need, the picker searches for one. */
          parentPicker={lockedParent ? undefined : "feature"}
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
 *
 * ## The escape hatch, added 2026-08-10
 *
 * Contextual alone meant the ONLY route to a requirement was selecting its feature first,
 * which is two levels of tree to expand before the form opens — and from a cold start the
 * button offered "Add product", which is not what anyone came to do. `alsoOffer` is the
 * caret: the default click stays contextual, and the menu reaches the other levels directly,
 * each with its parent searched for rather than navigated to. One control, so the reasoning
 * above survives; the drill-down does not.
 *
 * `mayAdminCatalogue` is presentation, never the gate. Product, Module and Feature CRUD is
 * `canAdmin` in `src/domain/catalogue.ts` and Requirement is `canWriteRequirements`; for an
 * author the three structural options are absent rather than present-and-rejecting, the same
 * rule `src/ui/navigation.ts` applies to nav items.
 */
export function ContextualCreate({
  selection,
  mayAdminCatalogue
}: {
  selection: { kind: "product" | "module" | "feature"; parent: Parent } | null;
  /** True for a QA Lead. False hides every option except Add requirement. */
  mayAdminCatalogue: boolean;
}) {
  // An author has exactly one thing they may create, so there is nothing for a caret to
  // hold: a split button whose menu offers its own default action is a worse plain button.
  if (!mayAdminCatalogue) {
    return (
      <AddRequirementModal
        lockedParent={selection?.kind === "feature" ? selection.parent : undefined}
        primary
      />
    );
  }

  // No candidate lists: each branch below either locks the parent from the selection or
  // searches for it. Fetching them cost three unbounded table reads on every load of the
  // screen — see `listProductOptions` in `src/domain/catalogue.ts`.
  if (selection === null) {
    return <AddProductModal primary alsoOffer={<AddRequirementModal />} />;
  }
  if (selection.kind === "product") {
    return (
      <AddModuleModal lockedParent={selection.parent} primary alsoOffer={<AddRequirementModal />} />
    );
  }
  if (selection.kind === "module") {
    return (
      <AddFeatureModal lockedParent={selection.parent} primary alsoOffer={<AddRequirementModal />} />
    );
  }
  return <AddRequirementModal lockedParent={selection.parent} primary />;
}
