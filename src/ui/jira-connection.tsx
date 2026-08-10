import Link from "next/link";
import { DisconnectJiraForm } from "./jira-disconnect";

/**
 * A person's own Jira connection: connect, or see that they are connected and disconnect.
 *
 * One component, mounted on `/account` (where every role can reach it) and on
 * `/admin/integrations` (where a QA Lead is already looking). The screens stay split as
 * agreed — deployment status is Lead-only and personal connection is not — but the control
 * itself exists once, so the two can never drift apart.
 *
 * Connecting is a plain link to a GET route, not a form: it is a redirect to Atlassian, and
 * a server action would have to redirect off-origin, which `form-action 'self'` in the CSP
 * forbids anyway.
 */
export function JiraConnectionPanel({
  connected,
  connectedAt,
  deploymentConfigured,
  serviceAccountFallback,
  status
}: {
  connected: boolean;
  connectedAt: Date | null;
  /** When false, there is nothing to connect TO and the button would only ever fail. */
  deploymentConfigured: boolean;
  serviceAccountFallback: boolean;
  /** The `?jira=` reason from a finished handshake, if this render follows one. */
  status?: string;
}) {
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>My Jira connection</h2>

      {status ? <JiraStatusNotice status={status} /> : null}

      {!deploymentConfigured ? (
        <p className="muted">
          Jira is not configured for this deployment, so there is nothing to connect to. Ask a
          QA Lead — this is an environment setting, not something you can change here.
        </p>
      ) : connected ? (
        <>
          <p className="muted">
            Connected{connectedAt ? ` on ${connectedAt.toISOString().slice(0, 10)}` : ""}. When a
            run you finalize completes its Jira issue, the transition is made as you.
          </p>
          <DisconnectJiraForm />
          <p className="muted" style={{ marginTop: "var(--sp-2)" }}>
            Disconnecting removes your stored Jira credential.{" "}
            {serviceAccountFallback
              ? "Syncs waiting on it are handed to the service account."
              : "Syncs waiting on it are given up and reported to a QA Lead, because nothing can replay them as you."}
          </p>
        </>
      ) : (
        <>
          <p className="muted">
            Not connected. Connect your Jira account so transitions caused by your test runs are
            recorded in Jira as you.{" "}
            {serviceAccountFallback
              ? "Until you do, they are made by the service account instead."
              : "Until you do, runs you finalize cannot update Jira at all."}
          </p>
          {/* A link, not a button: this is a redirect off-origin to Atlassian's consent screen. */}
          <Link className="btn" href="/api/v1/jira/connect">
            Connect Jira
          </Link>
        </>
      )}
    </div>
  );
}

/**
 * Turns the `?jira=` reason into a sentence.
 *
 * The reasons are deliberately coarse. A callback failure knows exactly what went wrong —
 * forged state, expired state, a state belonging to someone else — and says none of it here:
 * the detail is in the server log for a QA Lead, because a precise message would tell an
 * attacker which part of their attempt failed.
 */
function JiraStatusNotice({ status }: { status: string }) {
  const message =
    status === "connected"
      ? "Your Jira account is connected."
      : status === "disconnected"
        ? "Your Jira account has been disconnected."
        : status === "denied"
          ? "Jira did not approve the connection. Nothing was changed."
          : status === "unconfigured"
            ? "Jira is not configured for this deployment. Ask a QA Lead."
            : status === "exchange"
              ? "Jira could not complete the connection. Try again; if it keeps failing, a QA Lead can see why in the logs."
              : status === "invalid"
                ? "That connection attempt could not be verified, so nothing was changed. Start again from this page."
                : null;

  if (message === null) return null;

  return (
    <div className="notice" role="status">
      <span>{message}</span>
    </div>
  );
}
