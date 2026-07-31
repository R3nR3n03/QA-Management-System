"use client";

import { useActionState, useEffect, useRef } from "react";
import { FormNotice } from "@/ui/notice";
import type { FormState } from "@/ui/action";
import {
  CATALOGUE_PRIORITY,
  CATALOGUE_RESULT,
  CATALOGUE_SEVERITY
} from "@/lib/controlled-value-catalogues";
import { createControlledValueAction } from "./actions";

const CATALOGUES = [CATALOGUE_PRIORITY, CATALOGUE_SEVERITY, CATALOGUE_RESULT];

/**
 * Adds a value to one of the three documented catalogues. New values are created
 * active and immediately usable; a duplicate within the catalogue is refused. There
 * is no rename — deactivate the old value and add the new one.
 */
export function AddValueForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(createControlledValueAction, null);
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);

  // Reset after a successful submit (state is null only then) so the field is ready
  // for the next value.
  useEffect(() => {
    if (wasPending.current && !pending && state === null) formRef.current?.reset();
    wasPending.current = pending;
  }, [pending, state]);

  const bad = (field: string) => (state?.field === field ? "field field-bad" : "field");

  return (
    <form ref={formRef} action={formAction}>
      <FormNotice state={state} />
      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: "0 var(--sp-3)" }}>
        <label className={bad("catalogue")}>
          <span>Catalogue</span>
          <select name="catalogue" defaultValue={CATALOGUE_PRIORITY} disabled={pending}>
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
      </div>
      <button className="btn btn-secondary" type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add value"}
      </button>
    </form>
  );
}
