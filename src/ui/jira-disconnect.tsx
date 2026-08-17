"use client";

import { useActionState } from "react";
import { Unplug } from "lucide-react";
import { disconnectJiraAction } from "@/app/(app)/account/jira-actions";
import { FormNotice } from "./notice";
import type { FormState } from "./action";

/**
 * The Disconnect control.
 *
 * Its own client component so `JiraConnectionPanel` can stay a server component and be
 * mounted from two different server pages without either becoming a client boundary.
 *
 * Deliberately not a confirmation dialog. Disconnecting is reversible in one click, and the
 * consequence — queued syncs handed to the service account or given up — is stated next to
 * the button rather than hidden behind a modal nobody reads.
 */
export function DisconnectJiraForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    disconnectJiraAction,
    null
  );

  return (
    <form action={formAction}>
      <FormNotice state={state} id="jira-disconnect-notice" />
      <button className="btn btn-secondary btn-icon" type="submit" disabled={pending}>
        <Unplug size={15} strokeWidth={1.9} aria-hidden />
        {pending ? "Disconnecting…" : "Disconnect Jira"}
      </button>
    </form>
  );
}
