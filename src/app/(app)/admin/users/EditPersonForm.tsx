"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FormNotice } from "@/ui/notice";
import { ConfirmDialog, Modal } from "@/ui/modal";
import { useToast } from "@/ui/toast";
import type { FormState } from "@/ui/action";
import { fieldClass, fieldProps, noticeId } from "@/ui/form";
import { resetUserPasswordAction, setUserActiveAction, updateUserProfileAction } from "./actions";

const PROFILE_FORM_ID = "edit-person";
const ACTIVE_FORM_ID = "edit-person-active";
const PASSWORD_FORM_ID = "edit-person-password";

/**
 * Profile editing, deactivation/reactivation, and password reset for one person, in a
 * modal opened from their row. Three forms, one domain call each: `updateUserProfile`,
 * `setUserActive`, and `resetUserPassword`. Deactivation goes through a confirmation
 * dialog naming the person and the consequence; the guardrails (no self-deactivation,
 * never the last active QA Lead, no self-reset) live in the domain — the UI states them
 * and, for the self case, does not offer the button at all.
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
  const router = useRouter();
  const [profileState, profileAction, profilePending] = useActionState<FormState, FormData>(
    updateUserProfileAction,
    null
  );
  const [activeState, activeAction, activePending] = useActionState<FormState, FormData>(
    setUserActiveAction,
    null
  );
  const [passwordState, passwordAction, passwordPending] = useActionState<FormState, FormData>(
    resetUserPasswordAction,
    null
  );
  const wasProfilePending = useRef(false);
  const wasActivePending = useRef(false);
  const wasPasswordPending = useRef(false);
  const passwordFormRef = useRef<HTMLFormElement>(null);

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

  // Clear the password field once the reset succeeds, so it never lingers in the DOM —
  // same reasoning as ChangePasswordForm.
  //
  // The refresh is this screen's, not the action's. Every other action here redirects and
  // gets a fresh render out of the navigation, but this one has a confirmation to show and a
  // redirect would throw it away (`./actions.ts`), so the reset's own `version` bump is
  // picked up from here instead — leave it out and the next save in this still-open modal
  // posts a stale version and is refused. Running in the router's transition rather than the
  // action's is exactly what keeps the returned state from being stranded.
  useEffect(() => {
    if (wasPasswordPending.current && !passwordPending && passwordState?.success) {
      passwordFormRef.current?.reset();
      toast("Password reset.");
      router.refresh();
    }
    wasPasswordPending.current = passwordPending;
  }, [passwordPending, passwordState, toast, router]);

  const bad = (field: string) => fieldClass(profileState, field);
  const pending = profilePending || activePending || passwordPending;

  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
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
          <FormNotice state={profileState} id={noticeId(PROFILE_FORM_ID)} />
          <div className="form-grid-2">
            <label className={bad("displayName")}>
              <span>Name</span>
              <input name="displayName" defaultValue={displayName} required disabled={pending} autoFocus {...fieldProps(profileState, "displayName", PROFILE_FORM_ID)} />
            </label>
            <label className={bad("email")}>
              <span>Email</span>
              <input name="email" type="email" defaultValue={email} required disabled={pending} {...fieldProps(profileState, "email", PROFILE_FORM_ID)} />
            </label>
          </div>
          <button className="btn" type="submit" disabled={pending}>
            {profilePending ? "Saving…" : "Save changes"}
          </button>
        </form>

        <div style={{ marginTop: "var(--sp-5)", borderTop: "1px solid var(--line-soft)", paddingTop: "var(--sp-4)" }}>
          <FormNotice state={passwordState} id={noticeId(PASSWORD_FORM_ID)} />
          {isSelf ? (
            <p className="why" style={{ margin: 0 }}>
              <strong>Use your account settings to change your own password.</strong> This resets
              someone else&rsquo;s, for when they cannot supply their current one.
            </p>
          ) : (
            <form ref={passwordFormRef} action={passwordAction}>
              <input type="hidden" name="userId" value={userId} />
              <input type="hidden" name="version" value={version} />
              <label className={fieldClass(passwordState, "newPassword")}>
                <span>New password</span>
                <input
                  name="newPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  disabled={pending}
                  {...fieldProps(passwordState, "newPassword", PASSWORD_FORM_ID)}
                />
                <span className="hint">
                  At least 8 characters. Signs them out everywhere; share the new password with
                  them out of band.
                </span>
              </label>
              <button className="btn btn-secondary" type="submit" disabled={pending}>
                {passwordPending ? "Resetting…" : "Reset password"}
              </button>
            </form>
          )}
        </div>

        <div style={{ marginTop: "var(--sp-5)", borderTop: "1px solid var(--line-soft)", paddingTop: "var(--sp-4)" }}>
          {/* Only while the confirmation is closed — the dialog renders its own copy,
              and two live notices would share one DOM id. The reactivate button below
              submits straight from this modal, so this is where its outcome belongs. */}
          {confirming ? null : <FormNotice state={activeState} id={noticeId(ACTIVE_FORM_ID)} />}
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
        /* "The last active QA Lead cannot be deactivated" is a reachable rejection, and
           it used to render inside the modal UNDER this dialog's backdrop — so the one
           person who could hit it saw the button re-enable and nothing else. */
        notice={<FormNotice state={activeState} id={noticeId(ACTIVE_FORM_ID)} />}
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
