import { profile } from "@/domain/auth";
import { jiraConnectionFor } from "@/domain/jira-credentials";
import { organizationTimeZone } from "@/lib/app-config";
import { jiraConnectionStatus } from "@/lib/jira-config";
import { supportedTimeZones, UTC } from "@/lib/time-zone";
import { viewerStampFormat } from "@/ui/format";
import { JiraConnectionPanel } from "@/ui/jira-connection";
import { roleLabel } from "@/ui/navigation";
import { requireSession } from "@/ui/session";
import { ChangePasswordForm } from "./ChangePasswordForm";
import { DisplayPreferencesForm } from "./DisplayPreferencesForm";

export const dynamic = "force-dynamic";

/**
 * The signed-in user's own account: who the system thinks they are, and the things they
 * may change about it themselves — their password, and how times are shown to them. Role
 * changes stay with the QA Lead (`roles-workflows.md:16`), and so do everybody else's display
 * preferences: nobody sets another person's, because where somebody sits and how they read a
 * clock are facts only they hold (ADR-0007).
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
          stampFormat={viewerStampFormat(auth)}
        />
      </div>

      <h2>How times are shown</h2>
      <div className="card" style={{ maxWidth: 480, marginBottom: "var(--sp-5)" }}>
        <DisplayPreferencesForm
          timeZone={me?.timeZone ?? null}
          hourFormat={me?.hourFormat ?? null}
          zones={supportedTimeZones()}
          organizationZone={organizationTimeZone() ?? UTC}
        />
      </div>

      <h2>Change password</h2>
      <div className="card" style={{ maxWidth: 480 }}>
        <ChangePasswordForm />
      </div>
    </>
  );
}
