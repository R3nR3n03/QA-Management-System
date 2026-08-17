"use client";

import { useActionState } from "react";
import { HourFormat } from "@prisma/client";
import { FormNotice } from "@/ui/notice";
import type { FormState } from "@/ui/action";
import { fieldClass, fieldProps, noticeId } from "@/ui/form";
import { changeDisplayPreferencesAction } from "./actions";

const FORM_ID = "display-preferences";

/**
 * How this viewer sees a stamp: which clock, and which zone.
 *
 * ONE form for both, with one submit. They answer the same question, and somebody who moved
 * office and prefers a 12-hour clock had a single intention — two forms would make them save
 * twice and would put two rows in an append-only audit log for it (ADR-0007).
 *
 * The full IANA list arrives from the server rather than being derived here: `Intl` on a
 * browser and `Intl` in Node can disagree about which zones exist, and the one that has to
 * accept the value is the server. A `<select>` whose options came from the client could
 * therefore offer a zone the domain then rejects.
 *
 * Both blank options are real choices — "no preference", stored as null — not placeholders.
 * Clearing the zone is how somebody goes back to following the organization's wherever it
 * moves next; clearing the clock returns them to the 24-hour default.
 */
export function DisplayPreferencesForm({
  timeZone,
  hourFormat,
  zones,
  organizationZone
}: {
  /** Their stored zone, or null when they have never chosen one. */
  timeZone: string | null;
  /** Their stored clock, or null when they have never chosen one. */
  hourFormat: HourFormat | null;
  zones: string[];
  /** What "no preference" resolves to today, so the blank zone option can say so. */
  organizationZone: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    changeDisplayPreferencesAction,
    null
  );

  return (
    <form action={formAction}>
      <FormNotice state={state} id={noticeId(FORM_ID)} />

      <label className={fieldClass(state, "timeZone")}>
        <span>Time zone</span>
        <select
          name="timeZone"
          defaultValue={timeZone ?? ""}
          disabled={pending}
          {...fieldProps(state, "timeZone", FORM_ID)}
        >
          <option value="">Follow the organization ({organizationZone})</option>
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      </label>

      <label className={fieldClass(state, "hourFormat")}>
        <span>Clock</span>
        <select
          name="hourFormat"
          defaultValue={hourFormat ?? ""}
          disabled={pending}
          {...fieldProps(state, "hourFormat", FORM_ID)}
        >
          {/* The examples are the label. "24-hour" and "12-hour" are the words people use,
              but the sample stamp is what actually answers "which one do I want". */}
          <option value="">Use the default (14:30)</option>
          <option value={HourFormat.H24}>24-hour (14:30)</option>
          <option value={HourFormat.H12}>12-hour (02:30 PM)</option>
        </select>
      </label>

      <p className="why" style={{ marginBottom: "var(--sp-4)" }}>
        <strong>These change only what you see.</strong> Nothing recorded moves, and no list
        returns different rows — times are stored the same way for everyone and shown to you on
        your own clock.
      </p>

      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save preferences"}
      </button>
    </form>
  );
}
