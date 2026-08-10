import { QamsRole } from "@prisma/client";
import { notFound } from "next/navigation";
import { jiraConnectionRoster } from "@/domain/jira-credentials";
import { jiraConnectionStatus } from "@/lib/jira-config";
import { requireSession } from "@/ui/session";

export const dynamic = "force-dynamic";

/**
 * Read-only status of the outbound integrations.
 *
 * There is nothing to edit here, deliberately. The Jira connection is made of secrets, and
 * `docs/api-and-security.md#Authorization and security` requires secrets to live in
 * deployment-managed environment variables and never to be returned by an API — and a
 * settings screen is an API that returns its settings. Masking would not fix that: a masked
 * field still confirms the presence and length of a credential.
 *
 * What a QA Lead can act on is whether the sync is wired up at all, and where to. That is
 * what this shows. `jiraConnectionStatus()` is the projection allowed to leave the server:
 * connected, base URL, and whether a service-account fallback exists — never the client id,
 * the secret, or the token.
 */
export default async function IntegrationsPage() {
  const auth = await requireSession();
  // Lead-only screen: absent rather than present-and-rejecting for other roles.
  if (auth.role !== QamsRole.QA_LEAD) notFound();

  const jira = jiraConnectionStatus();
  const roster = await jiraConnectionRoster({
    userId: auth.userId,
    role: auth.role,
    requestId: "page"
  });

  return (
    <>
      <div className="page-head">
        <h1>Integrations</h1>
      </div>
      <p className="muted" style={{ marginBottom: "var(--sp-4)" }}>
        Connection settings are deployment configuration and are not editable here. Changing
        them means changing the environment and restarting the application.
      </p>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Jira execution sync</h2>

        <dl className="cat-stats" style={{ marginBottom: "var(--sp-4)" }}>
          <div className="cat-stat">
            <dt>Status</dt>
            <dd>{jira.connected ? "Connected" : "Not configured"}</dd>
          </div>
          <div className="cat-stat">
            <dt>Jira site</dt>
            <dd>{jira.baseUrl ?? "—"}</dd>
          </div>
          <div className="cat-stat">
            <dt>Service-account fallback</dt>
            <dd>{jira.serviceAccountFallback ? "Enabled" : "Disabled"}</dd>
          </div>
        </dl>

        {jira.connected ? (
          <p className="muted">
            When every execution carrying a Jira issue key is finalized and all of them pass,
            QAMS moves that issue to Done. A failed or blocked run never moves an issue, and
            QAMS never moves one backwards. The sync is one-way: changes made in Jira are
            never read back.
            {jira.serviceAccountFallback
              ? " Where a tester has no usable Jira credential, the transition is performed by the service account and appears in Jira under its name; the QAMS audit log records who actually caused it."
              : " Every transition is attributed to the person whose run caused it. If their Jira credential is missing or expired the sync fails and waits for someone to act on it."}
          </p>
        ) : (
          <p className="muted">
            No <code>JIRA_*</code> configuration is present, so no execution will ever contact
            Jira. Issue keys can still be recorded against runs; nothing is sent. See{" "}
            <code>.env.example</code> for the variables and{" "}
            <code>docs/architecture.md</code> for what the sync does once configured.
          </p>
        )}
      </div>

      {/*
        Who has connected — state only. Deliberately no Jira account, email or identity of
        any kind: a Lead needs to know who still has to connect, and never needs to know
        which third-party account someone linked in order to chase them (Q5).
      */}
      <div className="card" style={{ marginTop: "var(--sp-4)" }}>
        <h2 style={{ marginTop: 0 }}>Jira connections</h2>
        <p className="muted">
          {roster.connectedCount} of {roster.total} active people have connected their Jira
          account.{" "}
          {jira.serviceAccountFallback
            ? "Runs finalized by anyone else fall back to the service account."
            : "Runs finalized by anyone else cannot sync until they connect."}
        </p>

        <table className="table" style={{ marginTop: "var(--sp-3)" }}>
          <thead>
            <tr>
              <th scope="col">Person</th>
              <th scope="col">Jira</th>
            </tr>
          </thead>
          <tbody>
            {roster.rows.map((row) => (
              <tr key={row.userId}>
                <td>{row.displayName}</td>
                <td>{row.connected ? "Connected" : "Not connected"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="muted" style={{ marginTop: "var(--sp-3)" }}>
          People connect their own account from their Account page; it cannot be done for them.
        </p>
      </div>
    </>
  );
}
