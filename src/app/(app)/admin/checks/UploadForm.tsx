"use client";

import { useActionState, useRef, useState } from "react";
import { FileText, Upload } from "lucide-react";
import { FormNotice } from "@/ui/notice";
import type { FormState } from "@/ui/action";
import { fieldClass, fieldProps, noticeId } from "@/ui/form";
import { uploadCheckResultsAction } from "./actions";

const FORM_ID = "upload-check-results";
/** The file input's own id, so the caption above the zone can point at it. */
const INPUT_ID = "check-results-file";

/**
 * Upload one automation run's results.
 *
 * The copy here carries two facts a reader has to hold to make sense of what happens next:
 * a check reports rather than claims, and QAMS holds no link between a test case and a
 * spec, so a test only reaches a case by naming it.
 *
 * ## Why the control is a drop target and not the browser's own widget
 *
 * `.checks-screen` takes the 1440px opt-in because, as `DESIGN-SYSTEM.md` puts it, "the form
 * is the work" — and the form was then the platform's ~200px file button inside a card with
 * 900px to spend. The file being handed over has almost always just been dragged out of a CI
 * artifacts folder, so dragging it is the gesture to support.
 *
 * The real `<input type="file">` is still here, still the thing that submits, and still
 * focusable — only visually hidden inside the `<label>` (`.dropzone`). Nothing is
 * reimplemented: the keyboard reaches the platform control, and the browser suite's
 * `cy.hydrated('input[type="file"]').selectFile(…, { force: true })` still finds it.
 *
 * ## Why the size limit is worded the way it is
 *
 * `maxLabel` is passed in from the server rather than read here, and the copy says "this
 * deployment's limit" rather than stating a rule. `src/lib/upload-limits.ts` is explicit that
 * THE LIMIT IS NOT POLICY — `docs/api-and-security.md:49` places exact limits outside the
 * knowledge base — so a screen may report the configured value and must not present it as
 * something the documents decided.
 */
export function UploadForm({ maxLabel }: { maxLabel: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(uploadCheckResultsAction, null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** The chosen file, echoed back so a person can check it before committing. */
  const [held, setHeld] = useState<{ name: string; size: string } | null>(null);
  /** Whether a drag is currently over the zone. Presentation only. */
  const [over, setOver] = useState(false);
  const bad = fieldClass(state, "file");

  /**
   * Formatted here rather than through `formatBytes` in `src/lib/upload-limits.ts`: that module
   * imports `AppError`, and this is a client component. One decimal, because 1.4 MB and 1 MB
   * are a meaningful difference to somebody checking they picked the right run.
   */
  const sizeLabel = (bytes: number): string => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} bytes`;
  };

  const take = (file: File | undefined) => {
    setHeld(file ? { name: file.name, size: sizeLabel(file.size) } : null);
  };

  /**
   * A dropped file has to be written into the input, or the form would submit nothing while the
   * screen showed a name. `DataTransfer` is the only way to set `input.files`.
   */
  const drop = (event: React.DragEvent) => {
    event.preventDefault();
    setOver(false);
    const file = event.dataTransfer.files?.[0];
    if (!file || !inputRef.current) return;
    const bag = new DataTransfer();
    bag.items.add(file);
    inputRef.current.files = bag.files;
    take(file);
  };

  return (
    <form action={formAction}>
      <FormNotice state={state} id={noticeId(FORM_ID)} />
      {/*
       * A `<div class="field">` with an explicit `<label for>`, not a wrapping label — the zone
       * below is itself the input's label, and a second one around the caption would make the
       * caption open the picker too (the shape `.field` records for a field hosting a control).
       */}
      <div className={bad}>
        <label htmlFor={INPUT_ID}>
          <span>Results file (JUnit XML)</span>
        </label>
        <label
          className="dropzone"
          data-over={over ? "" : undefined}
          data-held={held ? "" : undefined}
          onDragOver={(event) => {
            event.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={drop}
        >
          <input
            ref={inputRef}
            id={INPUT_ID}
            type="file"
            name="file"
            accept=".xml,text/xml,application/xml"
            required
            disabled={pending}
            onChange={(event) => take(event.target.files?.[0])}
            {...fieldProps(state, "file", FORM_ID)}
          />
          {/*
           * Untinted, deliberately. `--pass` is reserved for what policy grades, and a green
           * mark beside an ingest form would read as "this passed" on the one screen whose
           * whole subject is checks passing and failing — the same trap `.fact-list` records
           * about a column of ticks. The icon changes; the tone does not.
           */}
          <span className="medallion medallion-sq" aria-hidden>
            {held ? (
              <FileText size={19} strokeWidth={1.9} aria-hidden />
            ) : (
              <Upload size={19} strokeWidth={1.9} aria-hidden />
            )}
          </span>
          {held ? (
            <>
              <span className="dropzone-text">
                <span className="dropzone-name">{held.name}</span>
                <span className="dropzone-said">{held.size} · ready to ingest</span>
              </span>
              {/* A `<span>` and never a `<button>`: a button inside a label inherits the
                  label's activation, so pressing it would fire the picker twice. As a span it
                  is a word describing what clicking the zone now does. */}
              <span className="dropzone-swap">Replace</span>
            </>
          ) : (
            <span className="dropzone-text">
              <span className="dropzone-title">Drop a JUnit XML results file here</span>
              <span className="dropzone-said">
                or choose a file · up to {maxLabel}, this deployment&rsquo;s limit
              </span>
            </span>
          )}
        </label>
        <span className="hint">
          Any runner that emits JUnit XML. Each test reaches a test case by naming its business
          ID — <span className="bid">TC-SAMPLE-0001</span> — in the test name or its class name.
        </span>
      </div>
      <p className="why" style={{ marginBottom: "var(--sp-4)" }}>
        <strong>A check reports; it never claims.</strong> Ingesting results records what the run
        observed. It starts and finalizes no execution, raises no defect, and moves no coverage,
        readiness or dashboard figure.
      </p>
      <button className="btn btn-icon" type="submit" disabled={pending}>
        <Upload size={15} aria-hidden /> {pending ? "Ingesting…" : "Ingest results"}
      </button>
    </form>
  );
}
