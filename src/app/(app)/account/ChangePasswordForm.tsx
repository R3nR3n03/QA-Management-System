"use client";

import { useActionState, useEffect, useRef } from "react";
import { FormNotice } from "@/ui/notice";
import type { FormState } from "@/ui/action";
import { changePasswordAction } from "./actions";

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(changePasswordAction, null);
  const formRef = useRef<HTMLFormElement>(null);

  // Clear both password fields once the change succeeds, so neither lingers in the DOM.
  useEffect(() => {
    if (state?.success) formRef.current?.reset();
  }, [state]);

  const bad = (field: string) => (state?.field === field ? "field field-bad" : "field");

  return (
    <form ref={formRef} action={formAction}>
      <FormNotice state={state} />

      <label className={bad("currentPassword")}>
        <span>Current password</span>
        <input name="currentPassword" type="password" autoComplete="current-password" required disabled={pending} />
      </label>

      <label className={bad("newPassword")}>
        <span>New password</span>
        <input name="newPassword" type="password" autoComplete="new-password" required minLength={8} disabled={pending} />
        <span className="hint">At least 8 characters.</span>
      </label>

      <p className="why" style={{ marginBottom: "var(--sp-4)" }}>
        <strong>Changing your password signs out every other session.</strong> Anywhere else you are
        signed in — another browser, another machine — stops working immediately. This browser stays
        signed in.
      </p>

      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Changing…" : "Change password"}
      </button>
    </form>
  );
}
