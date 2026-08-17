"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
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
 * Editing for the four catalogue levels. Each control is a button that opens a modal
 * pre-filled with the current values — hidden `id` + `version` travel with it, so a
 * concurrent edit surfaces as the VERSION_CONFLICT copy rather than a silent overwrite.
 * On success the modal closes, the screen revalidates, and a toast confirms. Business IDs
 * and parent links are deliberately absent: both are immutable (`docs/data-model.md`).
 * QA_LEAD gating is enforced in the domain.
 *
 * These were `Editable*Row` components that rendered a `.list-row` around their own Edit
 * button. The explorer needs the same control in two places with different geometry —
 * beside the record header, and inside a child row — so the control is now just the
 * button and its modal, and the caller owns the row. The modal machinery, the version
 * pair and the toast are untouched; only the wrapper went.
 */

type FieldSpec = {
  name: string;
  label: string;
  defaultValue: string;
  options?: string[];
  /**
   * Renders without `required`, so the field can be submitted empty.
   *
   * Every catalogue field was mandatory until the Jira project key, which must be clearable:
   * emptying it is how a QA Lead stops a product raising bugs, and that has to be an ordinary
   * save rather than something the browser refuses.
   */
  optional?: boolean;
  /** A line under the input, for a field whose effect is not obvious from its label. */
  hint?: string;
};

const FORM_ID = "edit-catalogue";

function EditControl({
  action,
  id,
  version,
  entity,
  recordLabel,
  fields,
  compact = false
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  id: string;
  version: number;
  entity: string;
  recordLabel: string;
  fields: FieldSpec[];
  /** Row-level placement: ghost and small, so a column of them does not shout. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);
  const toast = useToast();
  const wasPending = useRef(false);

  // Close the modal after a successful save (state is null only then); the screen
  // revalidates and the record re-renders with the new values and version.
  useEffect(() => {
    if (wasPending.current && !pending && state === null && open) {
      setOpen(false);
      toast(`${entity} updated.`);
    }
    wasPending.current = pending;
  }, [pending, state, open, entity, toast]);

  const bad = (field: string) => fieldClass(state, field);

  return (
    <>
      <button
        type="button"
        className={compact ? "btn btn-ghost btn-sm" : "btn btn-secondary"}
        onClick={() => setOpen(true)}
      >
        <Pencil size={13} aria-hidden style={{ verticalAlign: "-2px", marginRight: 6 }} />
        Edit
        {/* The column of row-level buttons all read "Edit"; this is what tells a screen
            reader which record each one belongs to. */}
        {compact ? <span className="sr-only"> {recordLabel}</span> : null}
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
              {field.options ? (
                <select name={field.name} defaultValue={field.defaultValue} required disabled={pending} {...fieldProps(state, field.name, FORM_ID)}>
                  {field.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  name={field.name}
                  defaultValue={field.defaultValue}
                  required={!field.optional}
                  disabled={pending}
                  {...fieldProps(state, field.name, FORM_ID)}
                />
              )}
              {field.hint ? <span className="hint">{field.hint}</span> : null}
            </label>
          ))}
          <button className="btn" type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </button>
        </form>
      </Modal>
    </>
  );
}

export function EditProductButton({
  id,
  version,
  businessId,
  name,
  versionTag,
  status,
  jiraProjectKey,
  compact
}: {
  id: string;
  version: number;
  businessId: string;
  name: string;
  versionTag: string;
  status: string;
  /** Null when this product raises no Jira bugs, which is the default. */
  jiraProjectKey: string | null;
  compact?: boolean;
}) {
  return (
    <EditControl
      action={updateProductAction}
      id={id}
      version={version}
      entity="Product"
      recordLabel={businessId}
      compact={compact}
      fields={[
        { name: "name", label: "Name", defaultValue: name },
        { name: "versionTag", label: "Version", defaultValue: versionTag },
        { name: "status", label: "Status", defaultValue: status, options: ["Active", "Inactive"] },
        {
          name: "jiraProjectKey",
          label: "Jira project key",
          // Empty renders an empty input, which is exactly what "raises nothing" should look
          // like — and submitting it unchanged keeps it that way.
          defaultValue: jiraProjectKey ?? "",
          optional: true,
          // States both directions, because the consequence of each is invisible from the
          // field itself and one of them writes into another team's Jira.
          hint: "Defects against this product are raised as bugs in this Jira project, for example SP. Leave empty to raise none."
        }
      ]}
    />
  );
}

export function EditModuleButton({
  id,
  version,
  businessId,
  name,
  compact
}: {
  id: string;
  version: number;
  businessId: string;
  name: string;
  compact?: boolean;
}) {
  return (
    <EditControl
      action={updateModuleAction}
      id={id}
      version={version}
      entity="Module"
      recordLabel={businessId}
      compact={compact}
      fields={[{ name: "name", label: "Name", defaultValue: name }]}
    />
  );
}

export function EditFeatureButton({
  id,
  version,
  businessId,
  name,
  compact
}: {
  id: string;
  version: number;
  businessId: string;
  name: string;
  compact?: boolean;
}) {
  return (
    <EditControl
      action={updateFeatureAction}
      id={id}
      version={version}
      entity="Feature"
      recordLabel={businessId}
      compact={compact}
      fields={[{ name: "name", label: "Name", defaultValue: name }]}
    />
  );
}

export function EditRequirementButton({
  id,
  version,
  businessId,
  statement,
  compact
}: {
  id: string;
  version: number;
  businessId: string;
  statement: string;
  compact?: boolean;
}) {
  return (
    <EditControl
      action={updateRequirementAction}
      id={id}
      version={version}
      entity="Requirement"
      recordLabel={businessId}
      compact={compact}
      fields={[{ name: "statement", label: "Statement", defaultValue: statement }]}
    />
  );
}
