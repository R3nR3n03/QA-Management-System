import { profile } from "@/domain/auth";
import { roleLabel } from "@/ui/navigation";
import { requireSession } from "@/ui/session";
import { ChangePasswordForm } from "./ChangePasswordForm";

export const dynamic = "force-dynamic";

/**
 * The signed-in user's own account: who the system thinks they are, and the one
 * thing they may change about it themselves — their password. Role changes stay with
 * the QA Lead (`roles-workflows.md:16`).
 */
export default async function AccountPage() {
  const auth = await requireSession();
  const me = await profile(auth.userId);

  return (
    <>
      <h1>My account</h1>
      <p className="muted" style={{ marginBottom: "var(--sp-4)" }}>
        {me?.displayName} · {me?.email} · {me ? roleLabel(me.role) : ""}. Your role is managed by the
        QA Lead.
      </p>

      <h2>Change password</h2>
      <div className="card" style={{ maxWidth: 480 }}>
        <ChangePasswordForm />
      </div>
    </>
  );
}
