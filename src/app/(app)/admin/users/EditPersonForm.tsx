"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { FormNotice } from "@/ui/notice";
import { ConfirmDialog, Modal } from "@/ui/modal";
import { useToast } from "@/ui/toast";
import type { FormState } from "@/ui/action";
import { setUserActiveAction, updateUserProfileAction } from "./actions";

/**
 * Profile editing and deactivation/reactivation for one person, in a modal opened
 * from their row. Two forms, one domain call each: `updateUserProfile` and
 * `setUserActive`. Deactivation goes through a confirmation dialog naming the
 * person and the consequence; the guardrails (no self-deactivation, never the last
 * active QA Lead) live in the domain — the UI states them and, for the self case,
 * does not offer the button at all.
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
  const [confirming, setConfirming] = useState(false);
  const toast = useToast();
  const [profileState, profileAction, profilePending] = useActionState<FormState, FormData>(
    updateUserProfileAction,
    null
  );
  const [activeState, activeAction, activePending] = useActionState<FormState, FormData>(
    setUserActiveAction,
    null
  );
  const wasProfilePending = useRef(false);
  const wasActivePending = useRef(false);

  // Close the modal after a successful profile save; the page revalidates with the
  // new values and version.
  useEffect(() => {
    if (wasProfilePending.current && !profilePending && profileState === null && open) {
      setOpen(false);
      toast("Profile updated.");
    }
    wasProfilePending.current = profilePending;
  }, [profilePending, profileState, open, toast]);

  // After an activation change succeeds, close both layers and confirm.
  useEffect(() => {
    if (wasActivePending.current && !activePending && activeState === null && open) {
      setConfirming(false);
      setOpen(false);
      toast(active ? "Account deactivated." : "Account reactivated.");
    }
    wasActivePending.current = activePending;
  }, [activePending, activeState, open, active, toast]);

  const bad = (field: string) => (profileState?.field === field ? "field field-bad" : "field");
  const pending = profilePending || activePending;

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => setOpen(true)}
        style={{ fontSize: 13, padding: "4px 10px" }}
      >
        Edit
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Edit person"
        description={`${displayName} — role changes stay on the list row; every change is audited.`}
      >
        <form action={profileAction}>
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="version" value={version} />
          <FormNotice state={profileState} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 var(--sp-4)" }}>
            <label className={bad("displayName")}>
              <span>Name</span>
              <input name="displayName" defaultValue={displayName} required disabled={pending} autoFocus />
            </label>
            <label className={bad("email")}>
              <span>Email</span>
              <input name="email" type="email" defaultValue={email} required disabled={pending} />
            </label>
          </div>
          <button className="btn" type="submit" disabled={pending}>
            {profilePending ? "Saving…" : "Save changes"}
          </button>
        </form>

        <div style={{ marginTop: "var(--sp-5)", borderTop: "1px solid var(--line-soft)", paddingTop: "var(--sp-4)" }}>
          <FormNotice state={activeState} />
          {isSelf ? (
            <p className="why" style={{ margin: 0 }}>
              <strong>You cannot deactivate your own account.</strong> Ask another QA Lead if it
              needs deactivating.
            </p>
          ) : active ? (
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => setConfirming(true)}
              disabled={pending}
            >
              Deactivate account…
            </button>
          ) : (
            <form action={activeAction} style={{ display: "inline" }}>
              <input type="hidden" name="userId" value={userId} />
              <input type="hidden" name="version" value={version} />
              <input type="hidden" name="active" value="true" />
              <button className="btn btn-secondary" type="submit" disabled={pending}>
                {activePending ? "Saving…" : "Reactivate account"}
              </button>
            </form>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Deactivate this account?"
        description="They are signed out immediately and cannot sign in until reactivated. Their records and history are preserved — no user is ever deleted."
        recordName={`${displayName} · ${email}`}
      >
        <form action={activeAction} style={{ display: "inline" }}>
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="version" value={version} />
          <input type="hidden" name="active" value="false" />
          <button className="btn btn-danger" type="submit" disabled={activePending}>
            {activePending ? "Deactivating…" : "Deactivate account"}
          </button>
        </form>
      </ConfirmDialog>
    </>
  );
}
