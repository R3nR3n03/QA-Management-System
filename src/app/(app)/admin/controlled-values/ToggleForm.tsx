"use client";

import { useActionState } from "react";
import { FormNotice } from "@/ui/notice";
import type { FormState } from "@/ui/action";
import { toggleControlledValueAction } from "./actions";

/**
 * Deactivating stops NEW records using the value; existing records keep it
 * (`docs/data-model.md`). Re-running the seed never resurrects a deactivated value,
 * so this toggle is the single switch that matters.
 */
export function ToggleForm({ id, version, active }: { id: string; version: number; active: boolean }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(toggleControlledValueAction, null);

  return (
    <form action={formAction} style={{ display: "inline" }}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="active" value={String(!active)} />
      <FormNotice state={state} />
      <button
        className="btn btn-secondary"
        type="submit"
        disabled={pending}
        style={{ fontSize: 13, padding: "4px 10px" }}
      >
        {pending ? "Saving…" : active ? "Deactivate" : "Reactivate"}
      </button>
    </form>
  );
}
