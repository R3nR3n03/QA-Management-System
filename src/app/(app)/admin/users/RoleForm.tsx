"use client";

import { useActionState } from "react";
import { FormNotice } from "@/ui/notice";
import type { FormState } from "@/ui/action";
import { noticeId } from "@/ui/form";
import { updateUserRoleAction } from "./actions";

const FORM_ID = "set-role";

const ROLES = [
  { value: "QA_TESTER", label: "QA Tester" },
  { value: "QA_ENGINEER", label: "QA Engineer" },
  { value: "SENIOR_QA_ENGINEER", label: "Senior QA Engineer" },
  { value: "QA_LEAD", label: "QA Lead" }
];

/** One role select per person; every change is audited with before/after. */
export function RoleForm({ userId, version, role }: { userId: string; version: number; role: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(updateUserRoleAction, null);

  return (
    <form action={formAction} className="stack">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="version" value={version} />
      <FormNotice state={state} id={noticeId(FORM_ID)} />
      <div className="row">
        <select name="role" defaultValue={role} disabled={pending} style={{ font: "inherit", padding: "4px 8px" }}>
          {ROLES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button className="btn btn-secondary btn-sm" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Set role"}
        </button>
      </div>
    </form>
  );
}
