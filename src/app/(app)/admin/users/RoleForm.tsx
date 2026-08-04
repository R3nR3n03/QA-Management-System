"use client";

import { useActionState, useState } from "react";
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

/**
 * One role select per person; every change is audited with before/after.
 *
 * ## Why your own row has no control
 *
 * Only a QA Lead reaches this screen, so the only role a Lead can give themselves is a
 * lower one — and a Lead who demotes themselves loses `/admin/users` on the very next
 * request. If they were the last active Lead, user management, controlled values and
 * reconciliation become unreachable for everyone, with no in-app way back.
 *
 * `EditPersonForm` already refuses self-deactivation for exactly this reason and says
 * so in the same words; role was the gap beside it. This is the near gate only: the
 * domain's `updateUserRole` has neither a self-demotion nor a last-lead guard (unlike
 * `setUserActive`, which has both), so the invariant is not yet enforced where it
 * counts. Closing that is a domain/policy change and belongs to the QA Lead.
 */
export function RoleForm({
  userId,
  version,
  role,
  displayName,
  isSelf
}: {
  userId: string;
  version: number;
  role: string;
  /** Names the control, so 50 rows are not 50 identical "Role" combo boxes. */
  displayName: string;
  isSelf: boolean;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(updateUserRoleAction, null);
  // The select shows the new role the instant it is picked, while the server still holds
  // the old one. Without a dirty check, navigating away silently discards the change
  // after the screen has displayed it as applied the whole time.
  const [selected, setSelected] = useState(role);

  if (isSelf) {
    const label = ROLES.find((option) => option.value === role)?.label ?? role;
    return (
      <p className="why" style={{ margin: 0 }}>
        <strong>You cannot change your own role.</strong> You are {label}. Ask another QA Lead if
        it needs changing.
      </p>
    );
  }

  return (
    <form action={formAction} className="stack">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="version" value={version} />
      <FormNotice state={state} id={noticeId(FORM_ID)} />
      <div className="row">
        <select
          name="role"
          className="select-filter"
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
          disabled={pending}
          aria-label={`Role for ${displayName}`}
        >
          {ROLES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          className="btn btn-secondary btn-sm"
          type="submit"
          disabled={pending || selected === role}
          aria-label={`Set role for ${displayName}`}
        >
          {pending ? "Saving…" : "Set role"}
        </button>
      </div>
    </form>
  );
}
