"use client";

import { useActionState, useState } from "react";
import { Check, Eye, EyeOff, KeyRound, Minus, ShieldAlert } from "lucide-react";
import { FormNotice } from "@/ui/notice";
import type { FormState } from "@/ui/action";
import { fieldClass, fieldProps, noticeId } from "@/ui/form";
import { changePasswordAction } from "./actions";

const FORM_ID = "change-password";

/**
 * One password box: the label, the field, and the control that reveals what was typed.
 *
 * The reveal is a real `<button>` sitting inside the input's right edge, not a checkbox
 * beside it — it acts on this field and no other, and at a checkbox's distance from three
 * stacked password inputs it would be unclear which. `aria-pressed` carries the state,
 * because the icon is the only visual channel and an icon is not a name.
 *
 * The label is a sibling of the input rather than its wrapper, the shape `FeaturePicker`
 * uses: a `<button>` nested inside a `<label>` has the label's activation behaviour applied
 * to it too, so every reveal click would also be a click on the field it is inside.
 */
function PasswordField({
  name,
  label,
  autoComplete,
  value,
  onChange,
  state,
  disabled,
  minLength,
  children
}: {
  name: string;
  label: string;
  autoComplete: string;
  value: string;
  onChange: (value: string) => void;
  state: FormState;
  disabled: boolean;
  minLength?: number;
  /** The hint or live check that belongs under this field, if it has one. */
  children?: React.ReactNode;
}) {
  const [shown, setShown] = useState(false);
  const id = `${FORM_ID}-${name}`;

  return (
    <div className={fieldClass(state, name)}>
      <label htmlFor={id}>
        <span>{label}</span>
      </label>
      <div className="field-affix">
        <input
          id={id}
          name={name}
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          required
          minLength={minLength}
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          {...fieldProps(state, name, FORM_ID)}
        />
        <button
          type="button"
          className="field-affix-btn"
          onClick={() => setShown((on) => !on)}
          aria-pressed={shown}
          aria-controls={id}
          aria-label={`${shown ? "Hide" : "Show"} ${label.toLowerCase()}`}
          title={shown ? "Hide" : "Show"}
          disabled={disabled}
        >
          {shown ? <EyeOff size={16} strokeWidth={1.9} aria-hidden /> : <Eye size={16} strokeWidth={1.9} aria-hidden />}
        </button>
      </div>
      {children}
    </div>
  );
}

/**
 * Change your own password.
 *
 * ## Why there is a confirmation field
 *
 * The characters are masked, so a typo in the new password is invisible — and the failure it
 * causes arrives later, at the next sign-in, with nothing left on screen to compare against.
 * Typing it twice is the only check available to a field nobody can read. The match is
 * reported as it is typed AND enforced on the server (`actions.ts`), because the live check
 * is JavaScript and the submit is not.
 *
 * The three values are held in state so the match can be computed and so all three can be
 * cleared on success — `form.reset()` alone would restore React's own values, not clear them.
 */
export function ChangePasswordForm({ minLength }: { minLength: number }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(changePasswordAction, null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  /*
   * Clear all three the moment a change succeeds, so no password lingers — in the DOM or in
   * React's copy of it.
   *
   * Adjusted during RENDER against the previous action state, not in an effect. The fields
   * are controlled, so React's values are the DOM's and there is nothing external to
   * synchronize; an effect would only re-render a second time to show what this render can
   * already show (react.dev, "You Might Not Need an Effect"). The identity guard is what
   * stops it looping — `useActionState` returns a new object per submit, so a changed
   * reference is exactly "a submit came back".
   */
  const [settled, setSettled] = useState(state);
  if (state !== settled) {
    setSettled(state);
    if (state?.success === true) {
      setCurrent("");
      setNext("");
      setConfirm("");
    }
  }

  // Silent until there is something to compare: "these do not match" the instant the first
  // character of the confirmation is typed is true, useless and unearned.
  const matches = confirm !== "" && next !== "" ? next === confirm : null;

  return (
    <form action={formAction}>
      <FormNotice state={state} id={noticeId(FORM_ID)} />

      {/* The three boxes, and the consequence of filling them in, beside each other once the
          card is wide enough for both — see `.settings-cols`. */}
      <div className="settings-cols">
        <div className="settings-main">
          <PasswordField
            name="currentPassword"
            label="Current password"
            autoComplete="current-password"
            value={current}
            onChange={setCurrent}
            state={state}
            disabled={pending}
          />

          <PasswordField
            name="newPassword"
            label="New password"
            autoComplete="new-password"
            value={next}
            onChange={setNext}
            state={state}
            disabled={pending}
            minLength={minLength}
          >
            <span className="hint">At least {minLength} characters.</span>
          </PasswordField>

          <PasswordField
            name="confirmPassword"
            label="Confirm new password"
            autoComplete="new-password"
            value={confirm}
            onChange={setConfirm}
            state={state}
            disabled={pending}
            minLength={minLength}
          >
            {/* Polite, and never red while somebody is still typing: a mismatch mid-word is
                not an error yet, it is an unfinished entry. The icon carries the state
                alongside the colour, so neither reading depends on hue alone. */}
            <span
              className="pw-match"
              data-state={matches === null ? "idle" : matches ? "on" : "off"}
              aria-live="polite"
            >
              {matches === null ? null : matches ? (
                <>
                  <Check size={14} strokeWidth={2.2} aria-hidden />
                  Both entries match.
                </>
              ) : (
                <>
                  <Minus size={14} strokeWidth={2.2} aria-hidden />
                  These do not match yet.
                </>
              )}
            </span>
          </PasswordField>
        </div>

        <p className="why why-icon">
          <ShieldAlert size={15} strokeWidth={1.9} aria-hidden />
          <span>
            <strong>Changing your password signs out every other session.</strong> Anywhere else
            you are signed in — another browser, another machine — stops working immediately.
            This browser stays signed in.
          </span>
        </p>
      </div>

      <button className="btn btn-icon acct-submit" type="submit" disabled={pending}>
        <KeyRound size={15} strokeWidth={1.9} aria-hidden />
        {pending ? "Changing…" : "Change password"}
      </button>
    </form>
  );
}
