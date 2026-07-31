"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { FormNotice } from "@/ui/notice";
import type { FormState } from "@/ui/action";
import { setUserActiveAction, updateUserProfileAction } from "./actions";

/**
 * Profile editing and deactivation/reactivation for one person, expanded inline from
 * their row. Two forms, one domain call each: `updateUserProfile` and `setUserActive`.
 * The guardrails (no self-deactivation, never the last active QA Lead) live in the
 * domain; the UI states the consequence and, for the self case, does not offer the
 * button at all.
 */
export function EditPersonForm({
  userId,
  version,
  displayName,
  email,
  active,
  isSelf
}: {
  userId: string;
  version: number;
  displayName: string;
  email: string;
  active: boolean;
  isSelf: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [profileState, profileAction, profilePending] = useActionState<FormState, FormData>(
    updateUserProfileAction,
    null
  );
  const [activeState, activeAction, activePending] = useActionState<FormState, FormData>(
    setUserActiveAction,
    null
  );
  const wasPending = useRef(false);

  // Collapse after a successful profile save; the page revalidates with the new
  // values and version. Activation changes keep the panel open so the outcome and
  // the reversal button stay visible.
  useEffect(() => {
    if (wasPending.current && !profilePending && profileState === null) setOpen(false);
    wasPending.current = profilePending;
  }, [profilePending, profileState]);

  const bad = (field: string) => (profileState?.field === field ? "field field-bad" : "field");
  const pending = profilePending || activePending;

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        style={{ fontSize: 13, padding: "4px 10px" }}
      >
        {open ? "Close" : "Edit"}
      </button>

      {open ? (
        <div style={{ flexBasis: "100%", paddingBottom: "var(--sp-2)" }}>
          <form action={profileAction}>
            <input type="hidden" name="userId" value={userId} />
            <input type="hidden" name="version" value={version} />
            <FormNotice state={profileState} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 var(--sp-4)" }}>
              <label className={bad("displayName")}>
                <span>Name</span>
                <input name="displayName" defaultValue={displayName} required disabled={pending} />
              </label>
              <label className={bad("email")}>
                <span>Email</span>
                <input name="email" type="email" defaultValue={email} required disabled={pending} />
              </label>
            </div>
            <button className="btn btn-secondary" type="submit" disabled={pending}>
              {profilePending ? "Saving…" : "Save changes"}
            </button>
          </form>

          <div style={{ marginTop: "var(--sp-4)" }}>
            <FormNotice state={activeState} />
            {isSelf ? (
              <p className="why">
                <strong>You cannot deactivate your own account.</strong> Ask another QA Lead if it
                needs deactivating.
              </p>
            ) : (
              <form action={activeAction}>
                <input type="hidden" name="userId" value={userId} />
                <input type="hidden" name="version" value={version} />
                <input type="hidden" name="active" value={String(!active)} />
                {active ? (
                  <p className="why" style={{ marginBottom: "var(--sp-3)" }}>
                    <strong>Deactivating signs this person out immediately</strong> and blocks
                    sign-in until reactivated. Their records and history are preserved — no user is
                    ever deleted.
                  </p>
                ) : (
                  <p className="muted" style={{ marginBottom: "var(--sp-3)" }}>
                    Reactivating lets this person sign in again. Sessions from before deactivation
                    stay dead.
                  </p>
                )}
                <button
                  className={active ? "btn btn-danger" : "btn btn-secondary"}
                  type="submit"
                  disabled={pending}
                >
                  {activePending ? "Saving…" : active ? "Deactivate account" : "Reactivate account"}
                </button>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
