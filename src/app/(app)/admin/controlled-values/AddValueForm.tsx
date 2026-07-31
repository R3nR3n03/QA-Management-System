"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { FormNotice } from "@/ui/notice";
import { Modal } from "@/ui/modal";
import { useToast } from "@/ui/toast";
import type { FormState } from "@/ui/action";
import {
  CATALOGUE_PRIORITY,
  CATALOGUE_RESULT,
  CATALOGUE_SEVERITY
} from "@/lib/controlled-value-catalogues";
import { createControlledValueAction } from "./actions";

const CATALOGUES = [CATALOGUE_PRIORITY, CATALOGUE_SEVERITY, CATALOGUE_RESULT];

/**
 * Adds a value to one of the three documented catalogues, in a modal. New values
 * are created active and immediately usable; a duplicate within the catalogue is
 * refused inline. There is no rename — deactivate the old value and add the new one.
 */
export function AddValueModal() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<FormState, FormData>(createControlledValueAction, null);
  const toast = useToast();
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && state === null && open) {
      setOpen(false);
      toast("Value added — active and usable immediately.");
    }
    wasPending.current = pending;
  }, [pending, state, open, toast]);

  const bad = (field: string) => (state?.field === field ? "field field-bad" : "field");

  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        <Plus size={14} aria-hidden style={{ verticalAlign: "-2px", marginRight: 6 }} />
        Add value
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add a controlled value"
        description="Created active and immediately selectable. Values are never renamed — deactivate and add instead."
        size="sm"
      >
        <form action={formAction}>
          <FormNotice state={state} />
          <label className={bad("catalogue")}>
            <span>Catalogue</span>
            <select name="catalogue" defaultValue={CATALOGUE_PRIORITY} disabled={pending} autoFocus>
              {CATALOGUES.map((catalogue) => (
                <option key={catalogue} value={catalogue}>
                  {catalogue}
                </option>
              ))}
            </select>
          </label>
          <label className={bad("value")}>
            <span>Value</span>
            <input name="value" required disabled={pending} />
          </label>
          <button className="btn" type="submit" disabled={pending}>
            {pending ? "Adding…" : "Add value"}
          </button>
        </form>
      </Modal>
    </>
  );
}
