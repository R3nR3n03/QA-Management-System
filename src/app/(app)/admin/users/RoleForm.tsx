"use client";

import { useActionState } from "react";
import { FormNotice } from "@/ui/notice";
import type { FormState } from "@/ui/action";
import { updateUserRoleAction } from "./actions";

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
    <form action={formAction} style={{ display: "flex", gap: "var(--sp-2)", alignItems: "center" }}>
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="version" value={version} />
      <FormNotice state={state} />
      <select name="role" defaultValue={role} disabled={pending} style={{ font: "inherit", padding: "4px 8px" }}>
        {ROLES.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button className="btn btn-secondary" type="submit" disabled={pending} style={{ fontSize: 13, padding: "4px 10px" }}>
        {pending ? "Saving…" : "Set role"}
      </button>
    </form>
  );
}
