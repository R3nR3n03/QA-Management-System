"use client";

import { useActionState, useRef, useEffect } from "react";
import { FormNotice } from "@/ui/notice";
import type { FormState } from "@/ui/action";
import { createUserAction } from "./actions";

const ROLES = [
  { value: "QA_TESTER", label: "QA Tester" },
  { value: "QA_ENGINEER", label: "QA Engineer" },
  { value: "SENIOR_QA_ENGINEER", label: "Senior QA Engineer" },
  { value: "QA_LEAD", label: "QA Lead" }
];

/**
 * Account creation, QA-Lead-gated in the domain. The initial password is chosen here
 * and communicated out of band — the form clears it on success and never echoes it,
 * and neither the response nor the audit event carries credential material.
 */
export function AddPersonForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(createUserAction, null);
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);

  // Reset the fields after a successful submit (state is null only then), so the
  // password does not linger in the DOM and the form is ready for the next person.
  useEffect(() => {
    if (wasPending.current && !pending && state === null) formRef.current?.reset();
    wasPending.current = pending;
  }, [pending, state]);

  const bad = (field: string) => (state?.field === field ? "field field-bad" : "field");

  return (
    <form ref={formRef} action={formAction}>
      <FormNotice state={state} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 var(--sp-4)" }}>
        <label className={bad("displayName")}>
          <span>Name</span>
          <input name="displayName" autoComplete="off" required disabled={pending} />
        </label>
        <label className={bad("email")}>
          <span>Email</span>
          <input name="email" type="email" autoComplete="off" required disabled={pending} />
        </label>
        <label className={bad("role")}>
          <span>Role</span>
          <select name="role" defaultValue="QA_TESTER" disabled={pending}>
            {ROLES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className={bad("password")}>
          <span>Initial password</span>
          <input name="password" type="password" autoComplete="new-password" required minLength={8} disabled={pending} />
          <span className="hint">At least 8 characters. Share it with them securely.</span>
        </label>
      </div>

      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add person"}
      </button>
    </form>
  );
}
