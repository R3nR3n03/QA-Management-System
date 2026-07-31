"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { FormNotice } from "@/ui/notice";
import { ConfirmDialog } from "@/ui/modal";
import { useToast } from "@/ui/toast";
import type { FormState } from "@/ui/action";
import { toggleControlledValueAction } from "./actions";

/**
 * Deactivating stops NEW records using the value; existing records keep it
 * (`docs/data-model.md`). Deactivation asks for confirmation with the value named —
 * it takes an option away from every form in the application — while reactivation
 * is immediate. Re-running the seed never resurrects a deactivated value.
 */
export function ToggleForm({
  id,
  version,
  active,
  catalogue,
  value
}: {
  id: string;
  version: number;
  active: boolean;
  catalogue: string;
  value: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState<FormState, FormData>(toggleControlledValueAction, null);
  const toast = useToast();
  const wasPending = useRef(false);
  const wasActive = useRef(active);

  useEffect(() => {
    if (wasPending.current && !pending && state === null) {
      setConfirming(false);
      toast(wasActive.current ? `"${value}" deactivated.` : `"${value}" reactivated.`);
    }
    wasPending.current = pending;
    wasActive.current = active;
  }, [pending, state, active, value, toast]);

  const hidden = (
    <>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="active" value={String(!active)} />
    </>
  );

  if (!active) {
    return (
      <form action={formAction} style={{ display: "inline" }}>
        {hidden}
        <FormNotice state={state} />
        <button
          className="btn btn-secondary"
          type="submit"
          disabled={pending}
          style={{ fontSize: 13, padding: "4px 10px" }}
        >
          {pending ? "Saving…" : "Reactivate"}
        </button>
      </form>
    );
  }

  return (
    <>
      <FormNotice state={state} />
      <button
        type="button"
        className="btn btn-danger"
        onClick={() => setConfirming(true)}
        disabled={pending}
        style={{ fontSize: 13, padding: "4px 10px" }}
      >
        Deactivate…
      </button>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Deactivate this value?"
        description="New records can no longer use it; existing records keep it. Reactivating later restores it — nothing is deleted."
        recordName={`${catalogue} · ${value}`}
      >
        <form action={formAction} style={{ display: "inline" }}>
          {hidden}
          <button className="btn btn-danger" type="submit" disabled={pending}>
            {pending ? "Deactivating…" : "Deactivate value"}
          </button>
        </form>
      </ConfirmDialog>
    </>
  );
}
