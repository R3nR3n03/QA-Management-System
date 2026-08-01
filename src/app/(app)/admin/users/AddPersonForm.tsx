"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { UserRoundPlus } from "lucide-react";
import { FormNotice } from "@/ui/notice";
import { Modal } from "@/ui/modal";
import { useToast } from "@/ui/toast";
import type { FormState } from "@/ui/action";
import { fieldClass, fieldProps, noticeId } from "@/ui/form";
import { createUserAction } from "./actions";

const FORM_ID = "add-person";

const ROLES = [
  { value: "QA_TESTER", label: "QA Tester" },
  { value: "QA_ENGINEER", label: "QA Engineer" },
  { value: "SENIOR_QA_ENGINEER", label: "Senior QA Engineer" },
  { value: "QA_LEAD", label: "QA Lead" }
];

/**
 * Account creation in a modal, QA-Lead-gated in the domain. The initial password is
 * chosen here and communicated out of band. On success the modal closes (taking the
 * password out of the DOM with it) and a toast confirms; on failure the inline
 * notice names the field.
 */
export function AddPersonModal() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<FormState, FormData>(createUserAction, null);
  const toast = useToast();
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && state === null && open) {
      setOpen(false);
      toast("Person added — share their initial password securely.");
    }
    wasPending.current = pending;
  }, [pending, state, open, toast]);

  const bad = (field: string) => fieldClass(state, field);

  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        <UserRoundPlus size={14} aria-hidden style={{ verticalAlign: "-2px", marginRight: 6 }} />
        Add person
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add a person"
        description="Enter their details and an initial password to share with them securely."
      >
        <form action={formAction}>
          <FormNotice state={state} id={noticeId(FORM_ID)} />
          <div className="form-grid-2">
            <label className={bad("displayName")}>
              <span>Name</span>
              <input name="displayName" autoComplete="off" required disabled={pending} autoFocus {...fieldProps(state, "displayName", FORM_ID)} />
            </label>
            <label className={bad("email")}>
              <span>Email</span>
              <input name="email" type="email" autoComplete="off" required disabled={pending} {...fieldProps(state, "email", FORM_ID)} />
            </label>
            <label className={bad("role")}>
              <span>Role</span>
              <select name="role" defaultValue="QA_TESTER" disabled={pending} {...fieldProps(state, "role", FORM_ID)}>
                {ROLES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={bad("password")}>
              <span>Initial password</span>
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                disabled={pending}
                {...fieldProps(state, "password", FORM_ID)}
              />
              <span className="hint">At least 8 characters.</span>
            </label>
          </div>
          <button className="btn" type="submit" disabled={pending}>
            {pending ? "Adding…" : "Add person"}
          </button>
        </form>
      </Modal>
    </>
  );
}
