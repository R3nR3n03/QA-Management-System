"use client";

import { useActionState } from "react";
import { FormNotice } from "@/ui/notice";
import { noticeId } from "@/ui/form";
import { startExecutionAction, type FormState } from "./actions";

const FORM_ID = "start-execution";

export function StartForm({ executionId, version }: { executionId: string; version: number }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    startExecutionAction,
    null
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="executionId" value={executionId} />
      <input type="hidden" name="version" value={version} />

      <FormNotice state={state} id={noticeId(FORM_ID)} />

      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Starting…" : "Start this run"}
      </button>
      <p className="muted" style={{ marginTop: "var(--sp-2)" }}>
        Starting records the time and moves this run to In Progress. You can finalize it whenever
        you are done.
      </p>
    </form>
  );
}
