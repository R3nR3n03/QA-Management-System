"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { FormNotice } from "@/ui/notice";
import { Modal } from "@/ui/modal";
import { useToast } from "@/ui/toast";
import type { FormState } from "@/ui/action";
import { fieldClass, fieldProps, noticeId } from "@/ui/form";
import {
  updateFeatureAction,
  updateModuleAction,
  updateProductAction,
  updateRequirementAction
} from "./actions";

/**
 * Editing for the four catalogue levels. Each `.list-row` carries an Edit button
 * that opens a modal pre-filled with the current values — hidden `id` + `version`
 * travel with it, so a concurrent edit surfaces as the VERSION_CONFLICT copy rather
 * than a silent overwrite. On success the modal closes, the list revalidates, and a
 * toast confirms. Business IDs and parent links are deliberately absent: both are
 * immutable (`docs/data-model.md`). QA_LEAD gating is enforced in the domain.
 */

type FieldSpec = { name: string; label: string; defaultValue: string };

const FORM_ID = "edit-catalogue";

function EditableRow({
  action,
  id,
  version,
  entity,
  recordLabel,
  fields,
  children
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  id: string;
  version: number;
  entity: string;
  recordLabel: string;
  fields: FieldSpec[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);
  const toast = useToast();
  const wasPending = useRef(false);

  // Close the modal after a successful save (state is null only then); the page
  // revalidates and the row re-renders with the new values and version.
  useEffect(() => {
    if (wasPending.current && !pending && state === null && open) {
      setOpen(false);
      toast(`${entity} updated.`);
    }
    wasPending.current = pending;
  }, [pending, state, open, entity, toast]);

  const bad = (field: string) => fieldClass(state, field);

  return (
    <div className="list-row">
      {children}
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
        Edit
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Edit ${entity.toLowerCase()}`}
        description={`${recordLabel} — the ID and its place in the hierarchy are immutable.`}
      >
        <form action={formAction}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="version" value={version} />
          <FormNotice state={state} id={noticeId(FORM_ID)} />
          {fields.map((field) => (
            <label key={field.name} className={bad(field.name)}>
              <span>{field.label}</span>
              <input name={field.name} defaultValue={field.defaultValue} required disabled={pending} {...fieldProps(state, field.name, FORM_ID)} />
            </label>
          ))}
          <button className="btn" type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </button>
        </form>
      </Modal>
    </div>
  );
}

export function EditableProductRow({
  id,
  version,
  businessId,
  name,
  versionTag,
  status,
  children
}: {
  id: string;
  version: number;
  businessId: string;
  name: string;
  versionTag: string;
  status: string;
  children: React.ReactNode;
}) {
  return (
    <EditableRow
      action={updateProductAction}
      id={id}
      version={version}
      entity="Product"
      recordLabel={businessId}
      fields={[
        { name: "name", label: "Name", defaultValue: name },
        { name: "versionTag", label: "Version", defaultValue: versionTag },
        { name: "status", label: "Status", defaultValue: status }
      ]}
    >
      {children}
    </EditableRow>
  );
}

export function EditableModuleRow({
  id,
  version,
  businessId,
  name,
  children
}: {
  id: string;
  version: number;
  businessId: string;
  name: string;
  children: React.ReactNode;
}) {
  return (
    <EditableRow
      action={updateModuleAction}
      id={id}
      version={version}
      entity="Module"
      recordLabel={businessId}
      fields={[{ name: "name", label: "Name", defaultValue: name }]}
    >
      {children}
    </EditableRow>
  );
}

export function EditableFeatureRow({
  id,
  version,
  businessId,
  name,
  children
}: {
  id: string;
  version: number;
  businessId: string;
  name: string;
  children: React.ReactNode;
}) {
  return (
    <EditableRow
      action={updateFeatureAction}
      id={id}
      version={version}
      entity="Feature"
      recordLabel={businessId}
      fields={[{ name: "name", label: "Name", defaultValue: name }]}
    >
      {children}
    </EditableRow>
  );
}

export function EditableRequirementRow({
  id,
  version,
  businessId,
  statement,
  children
}: {
  id: string;
  version: number;
  businessId: string;
  statement: string;
  children: React.ReactNode;
}) {
  return (
    <EditableRow
      action={updateRequirementAction}
      id={id}
      version={version}
      entity="Requirement"
      recordLabel={businessId}
      fields={[{ name: "statement", label: "Statement", defaultValue: statement }]}
    >
      {children}
    </EditableRow>
  );
}
