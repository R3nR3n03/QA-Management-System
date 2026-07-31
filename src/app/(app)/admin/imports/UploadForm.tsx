"use client";

import { useActionState } from "react";
import { FormNotice } from "@/ui/notice";
import type { FormState } from "@/ui/action";
import { uploadWorkbookAction } from "./actions";

/**
 * The seed import. The upload is throttled and size-limited, headers are validated
 * before any write, and every row lands in the run report — including the ones that
 * were rejected or need reconciliation.
 */
export function UploadForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(uploadWorkbookAction, null);
  const bad = state?.field === "file" ? "field field-bad" : "field";

  return (
    <form action={formAction}>
      <FormNotice state={state} />
      <label className={bad}>
        <span>Workbook (.xlsx)</span>
        <input type="file" name="file" accept=".xlsx" required disabled={pending} />
        <span className="hint">All 13 documented sheets must be present; headers are checked before anything is written.</span>
      </label>
      <p className="why" style={{ marginBottom: "var(--sp-4)" }}>
        <strong>Imported test cases enter as Approved</strong> under the seed-import exception in
        the workflow policy, and the run report records that decision.
      </p>
      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Importing…" : "Import workbook"}
      </button>
    </form>
  );
}
