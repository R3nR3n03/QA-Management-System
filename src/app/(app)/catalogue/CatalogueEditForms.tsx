"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { FormNotice } from "@/ui/notice";
import type { FormState } from "@/ui/action";
import {
  updateFeatureAction,
  updateModuleAction,
  updateProductAction,
  updateRequirementAction
} from "./actions";

/**
 * Inline editing for the four catalogue levels. Each `.list-row` carries an Edit
 * toggle that expands the row into a small form — hidden `id` + `version` travel with
 * it, so a concurrent edit surfaces as the VERSION_CONFLICT copy rather than a silent
 * overwrite. Business IDs and parent links are deliberately absent: both are immutable
 * (`docs/data-model.md` — business IDs are immutable; re-parenting is not a documented
 * operation). QA_LEAD gating is enforced in the domain either way.
 */

type FieldSpec = { name: string; label: string; defaultValue: string };

function EditableRow({
  action,
  id,
  version,
  fields,
  children
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  id: string;
  version: number;
  fields: FieldSpec[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);
  const wasPending = useRef(false);

  // Collapse the form after a successful save (state is null only then); the page
  // revalidates and the row re-renders with the new values and version.
  useEffect(() => {
    if (wasPending.current && !pending && state === null) setOpen(false);
    wasPending.current = pending;
  }, [pending, state]);

  const bad = (field: string) => (state?.field === field ? "field field-bad" : "field");

  return (
    <div className="list-row" style={{ display: "block" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", flexWrap: "wrap" }}>
        {children}
        <button
          type="button"
          className="btn btn-ghost"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          style={{ fontSize: 13, padding: "4px 10px" }}
        >
          {open ? "Close" : "Edit"}
        </button>
      </div>

      {open ? (
        <form action={formAction} style={{ marginTop: "var(--sp-3)" }}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="version" value={version} />
          <FormNotice state={state} />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${Math.min(fields.length, 3)}, 1fr)`,
              gap: "0 var(--sp-3)"
            }}
          >
            {fields.map((field) => (
              <label key={field.name} className={bad(field.name)}>
                <span>{field.label}</span>
                <input name={field.name} defaultValue={field.defaultValue} required disabled={pending} />
              </label>
            ))}
          </div>
          <button className="btn btn-secondary" type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </button>
        </form>
      ) : null}
    </div>
  );
}

export function EditableProductRow({
  id,
  version,
  name,
  versionTag,
  status,
  children
}: {
  id: string;
  version: number;
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
  name,
  children
}: {
  id: string;
  version: number;
  name: string;
  children: React.ReactNode;
}) {
  return (
    <EditableRow
      action={updateModuleAction}
      id={id}
      version={version}
      fields={[{ name: "name", label: "Name", defaultValue: name }]}
    >
      {children}
    </EditableRow>
  );
}

export function EditableFeatureRow({
  id,
  version,
  name,
  children
}: {
  id: string;
  version: number;
  name: string;
  children: React.ReactNode;
}) {
  return (
    <EditableRow
      action={updateFeatureAction}
      id={id}
      version={version}
      fields={[{ name: "name", label: "Name", defaultValue: name }]}
    >
      {children}
    </EditableRow>
  );
}

export function EditableRequirementRow({
  id,
  version,
  statement,
  children
}: {
  id: string;
  version: number;
  statement: string;
  children: React.ReactNode;
}) {
  return (
    <EditableRow
      action={updateRequirementAction}
      id={id}
      version={version}
      fields={[{ name: "statement", label: "Statement", defaultValue: statement }]}
    >
      {children}
    </EditableRow>
  );
}
