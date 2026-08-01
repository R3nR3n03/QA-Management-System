"use client";

import { useActionState } from "react";
import { FormNotice } from "@/ui/notice";
import type { FormState } from "@/ui/action";
import { fieldClass, fieldProps, noticeId } from "@/ui/form";
import { uploadWorkbookAction } from "./actions";

const FORM_ID = "upload-workbook";

/**
 * The seed import. The upload is throttled and size-limited, headers are validated
 * before any write, and every row lands in the run report — including the ones that
 * were rejected or need reconciliation.
 */
export function UploadForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(uploadWorkbookAction, null);
  const bad = fieldClass(state, "file");

  return (
    <form action={formAction}>
      <FormNotice state={state} id={noticeId(FORM_ID)} />
      <label className={bad}>
        <span>Workbook (.xlsx)</span>
        <input type="file" name="file" accept=".xlsx" required disabled={pending} {...fieldProps(state, "file", FORM_ID)} />
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
