"use client";

import { useActionState, useState } from "react";
import { Clock3, Info, Save } from "lucide-react";
import { HourFormat } from "@prisma/client";
import { DEFAULT_HOUR_CLOCK, formatInZone, type HourClock, type TimeZoneGroup } from "@/lib/time-zone";
import { FormNotice } from "@/ui/notice";
import type { FormState } from "@/ui/action";
import { fieldClass, fieldProps, noticeId } from "@/ui/form";
import { changeDisplayPreferencesAction } from "./actions";

const FORM_ID = "display-preferences";

/**
 * The client-side twin of `hourClockFor` (`src/ui/format.ts`), which cannot be imported here:
 * it pulls `app-config.ts`, and with it `process.env`, into the browser bundle. Both map the
 * same two enum members, and the preview below is the only thing this one feeds — nothing
 * stored or submitted passes through it.
 */
const CLOCKS: Record<string, HourClock> = {
  [HourFormat.H12]: "h12",
  [HourFormat.H24]: "h23",
  "": DEFAULT_HOUR_CLOCK
};

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
 *
 * ## Why the choices are echoed back as a stamp
 *
 * Neither control shows its own effect. `Asia/Manila` and `H12` are the stored values, not
 * the thing a reader is choosing between — what they actually want to know is what a row in
 * the executions list will say once they save. The preview renders exactly that, through the
 * same `formatInZone` every screen uses, and it moves as the selects move. It is deliberately
 * an example and not a live clock: it is drawn from the instant the page was served, so it is
 * a specimen of the FORMAT rather than a second, slowly-wrong statement of the time.
 */
export function DisplayPreferencesForm({
  timeZone,
  hourFormat,
  zones,
  organizationZone,
  nowIso
}: {
  /** Their stored zone, or null when they have never chosen one. */
  timeZone: string | null;
  /** Their stored clock, or null when they have never chosen one. */
  hourFormat: HourFormat | null;
  /** The pickable zones, grouped and offset-labelled by `timeZoneChoices`. */
  zones: TimeZoneGroup[];
  /** What "no preference" resolves to today, so the blank zone option can say so. */
  organizationZone: string;
  /** The instant the page was served, ISO-8601. The specimen the preview is drawn from. */
  nowIso: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    changeDisplayPreferencesAction,
    null
  );

  // Mirrored so the preview can follow the controls. The selects stay uncontrolled in every
  // other respect — `defaultValue` is still what a form reset and a no-JS submit rely on.
  const [zoneChoice, setZoneChoice] = useState(timeZone ?? "");
  const [clockChoice, setClockChoice] = useState<string>(hourFormat ?? "");

  const preview = formatInZone(
    new Date(nowIso),
    zoneChoice === "" ? organizationZone : zoneChoice,
    CLOCKS[clockChoice] ?? DEFAULT_HOUR_CLOCK
  );

  return (
    <form action={formAction}>
      <FormNotice state={state} id={noticeId(FORM_ID)} />

      {/* The controls, and the note that qualifies them, beside each other once the card is
          wide enough for both — see `.settings-cols`. Stacked, this is the order it reads in. */}
      <div className="settings-cols">
        <div className="settings-main">
          <label className={fieldClass(state, "timeZone")}>
            <span>Time zone</span>
            <select
              name="timeZone"
              defaultValue={timeZone ?? ""}
              disabled={pending}
              onChange={(event) => setZoneChoice(event.target.value)}
              {...fieldProps(state, "timeZone", FORM_ID)}
            >
              <option value="">Follow the organization ({organizationZone})</option>
              {/* Grouped and offset-labelled rather than four hundred bare names in one run:
                  `Asia/Makassar` and `Asia/Manila` are two keystrokes apart and eight hundred
                  miles, and the offset is what tells them apart at a glance. */}
              {zones.map((group) => (
                <optgroup key={group.region} label={group.region}>
                  {group.zones.map((zone) => (
                    <option key={zone.value} value={zone.value}>
                      {zone.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <label className={fieldClass(state, "hourFormat")}>
            <span>Clock</span>
            <select
              name="hourFormat"
              defaultValue={hourFormat ?? ""}
              disabled={pending}
              onChange={(event) => setClockChoice(event.target.value)}
              {...fieldProps(state, "hourFormat", FORM_ID)}
            >
              {/* The examples are the label. "24-hour" and "12-hour" are the words people use,
                  but the sample stamp is what actually answers "which one do I want". */}
              <option value="">Use the default (14:30)</option>
              <option value={HourFormat.H24}>24-hour (14:30)</option>
              <option value={HourFormat.H12}>12-hour (02:30 PM)</option>
            </select>
          </label>

          {/* Announced politely: it changes on every keystroke-equivalent of a select change,
              and a reader who cannot see it moving still needs to hear what they chose. */}
          <p className="setting-preview" aria-live="polite">
            <Clock3 size={15} strokeWidth={1.9} aria-hidden />
            <span>
              Times will read <strong>{preview}</strong>
            </span>
          </p>
        </div>

        <p className="why why-icon">
          <Info size={15} strokeWidth={1.9} aria-hidden />
          <span>
            <strong>These change only what you see.</strong> Nothing recorded moves, and no list
            returns different rows — times are stored the same way for everyone and shown to you
            on your own clock.
          </span>
        </p>
      </div>

      <button className="btn btn-icon acct-submit" type="submit" disabled={pending}>
        <Save size={15} strokeWidth={1.9} aria-hidden />
        {pending ? "Saving…" : "Save preferences"}
      </button>
    </form>
  );
}
