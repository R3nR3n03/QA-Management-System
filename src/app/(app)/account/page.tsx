import { profile } from "@/domain/auth";
import { jiraConnectionFor } from "@/domain/jira-credentials";
import { jiraConnectionStatus } from "@/lib/jira-config";
import { JiraConnectionPanel } from "@/ui/jira-connection";
import { roleLabel } from "@/ui/navigation";
import { requireSession } from "@/ui/session";
import { ChangePasswordForm } from "./ChangePasswordForm";

export const dynamic = "force-dynamic";

/**
 * The signed-in user's own account: who the system thinks they are, and the one
 * thing they may change about it themselves — their password. Role changes stay with
 * the QA Lead (`roles-workflows.md:16`).
 */
export default async function AccountPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireSession();
  const params = await searchParams;
  const [me, jira, deployment] = await Promise.all([
    profile(auth.userId),
    jiraConnectionFor(auth.userId),
    Promise.resolve(jiraConnectionStatus())
  ]);
  const jiraStatus = typeof params.jira === "string" ? params.jira : undefined;

  return (
    <>
      <h1>My account</h1>
      <p className="muted" style={{ marginBottom: "var(--sp-4)" }}>
        {me?.displayName} · {me?.email} · {me ? roleLabel(me.role) : ""}. Your role is managed by the
        QA Lead.
      </p>

      <div style={{ marginBottom: "var(--sp-5)" }}>
        <JiraConnectionPanel
          connected={jira.connected}
          connectedAt={jira.connectedAt}
          deploymentConfigured={deployment.connected}
          serviceAccountFallback={deployment.serviceAccountFallback}
          status={jiraStatus}
        />
      </div>

      <h2>Change password</h2>
      <div className="card" style={{ maxWidth: 480 }}>
        <ChangePasswordForm />
      </div>
    </>
  );
}
