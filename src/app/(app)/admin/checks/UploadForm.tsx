"use client";

import { useActionState } from "react";
import { FormNotice } from "@/ui/notice";
import type { FormState } from "@/ui/action";
import { fieldClass, fieldProps, noticeId } from "@/ui/form";
import { uploadCheckResultsAction } from "./actions";

const FORM_ID = "upload-check-results";

/**
 * Upload one automation run's results.
 *
 * The copy here carries two facts a reader has to hold to make sense of what happens next:
 * a check reports rather than claims, and QAMS holds no link between a test case and a
 * spec, so a test only reaches a case by naming it.
 */
export function UploadForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(uploadCheckResultsAction, null);
  const bad = fieldClass(state, "file");

  return (
    <form action={formAction}>
      <FormNotice state={state} id={noticeId(FORM_ID)} />
      <label className={bad}>
        <span>Results file (JUnit XML)</span>
        <input
          type="file"
          name="file"
          accept=".xml,text/xml,application/xml"
          required
          disabled={pending}
          {...fieldProps(state, "file", FORM_ID)}
        />
        <span className="hint">
          Any runner that emits JUnit XML. Each test reaches a test case by naming its business
          ID — <span className="bid">TC-PROD001-0001</span> — in the test name or its class name.
        </span>
      </label>
      <p className="why" style={{ marginBottom: "var(--sp-4)" }}>
        <strong>A check reports; it never claims.</strong> Ingesting results records what the run
        observed. It starts and finalizes no execution, raises no defect, and moves no coverage,
        readiness or dashboard figure.
      </p>
      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Ingesting…" : "Ingest results"}
      </button>
    </form>
  );
}
