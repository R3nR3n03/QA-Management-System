import { Cable, Users, Workflow } from "lucide-react";
import { QamsRole } from "@prisma/client";
import { notFound } from "next/navigation";
import { jiraConnectionFor, jiraConnectionRoster } from "@/domain/jira-credentials";
import { jiraConnectionStatus } from "@/lib/jira-config";
import { JiraConnectionPanel } from "@/ui/jira-connection";
import { formatMinute, viewerStampFormat } from "@/ui/format";
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
 *
 * ## The shape of the screen
 *
 * The screen's SUBJECT is the deployment — does it sync, and who can it sync as — so those two
 * panels take the main column, and the Lead's own connection moves to the rail. It used to sit
 * between them, interrupting the one question the screen exists to answer with a personal aside;
 * it is a convenience here ("a Lead looking at this page should not have to go elsewhere to
 * connect themselves"), not the subject.
 *
 * The roster is what earns the width (`.shell-main:has(.integrations-screen)` is uncapped): a
 * list of names and states tiles into columns, so a wider screen shows more of the roster rather
 * than a wider one. Every measure of prose on the screen is capped in its own right.
 */
export default async function IntegrationsPage() {
  const auth = await requireSession();
  // Lead-only screen: absent rather than present-and-rejecting for other roles.
  if (auth.role !== QamsRole.QA_LEAD) notFound();

  const jira = jiraConnectionStatus();
  const [roster, mine] = await Promise.all([
    jiraConnectionRoster({ userId: auth.userId, role: auth.role, requestId: "page" }),
    jiraConnectionFor(auth.userId)
  ]);
  const stampFormat = viewerStampFormat(auth);

  return (
    <div className="integrations-screen">
      {/* A `.page-banner` rather than a `.page-head`: the subject is a PROCESS a reader has to
          understand before the panels mean anything — that these are deployment settings, and
          that nothing on this screen can change them. That is the one case the banner is for. */}
      <div className="page-banner">
        <span className="medallion medallion-lg medallion-sq" aria-hidden>
          <Cable size={22} strokeWidth={1.9} aria-hidden />
        </span>
        <div className="page-banner-text">
          <h1>Integrations</h1>
          <p className="page-banner-lede">
            Connection settings are deployment configuration and are not editable here. Changing
            them means changing the environment and restarting the application.
          </p>
        </div>
      </div>

      <div className="integrations-cols">
        <div className="integrations-main">
          <section className="card">
            <div className="panel-head">
              <span className="medallion" aria-hidden>
                <Workflow size={19} strokeWidth={1.9} aria-hidden />
              </span>
              <div className="panel-head-text">
                <h2>Jira execution sync</h2>
                <p>What this deployment does when a run carrying an issue key is finalized.</p>
              </div>
            </div>

            {/*
             * `.fact-grid`, the pattern every other record screen states its attributes with. It
             * was `.cat-stats` — the catalogue's own tally — which is a count of children, not a
             * set of named values, and borrowing it here made three settings look like three
             * figures.
             *
             * Status takes a chip because it is a STATE, and the other two are values. The chip is
             * `.state-accent` and never `.state-pass`, on the rule `JiraConnectionPanel`'s own
             * chip records: the Pass tone is reserved for what policy grades, and a configured
             * integration is not a QA result.
             */}
            <dl className="fact-grid integrations-facts">
              <div>
                <dt>Status</dt>
                <dd>
                  <span className={jira.connected ? "state state-accent" : "state"}>
                    {jira.connected ? "Connected" : "Not configured"}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Jira site</dt>
                {/* The one value on the screen a reader compares character by character against
                    what they set in the environment, so it is monospaced. */}
                <dd className="integrations-site">{jira.baseUrl ?? "—"}</dd>
              </div>
              <div>
                <dt>Service-account fallback</dt>
                <dd>{jira.serviceAccountFallback ? "Enabled" : "Disabled"}</dd>
              </div>
            </dl>

            {jira.connected ? (
              <p className="muted integrations-said">
                When every execution carrying a Jira issue key is finalized and all of them pass,
                QAMS moves that issue to Done. A failed or blocked run never moves an issue, and
                QAMS never moves one backwards. The sync is one-way: changes made in Jira are
                never read back.
                {jira.serviceAccountFallback
                  ? " Where a tester has no usable Jira credential, the transition is performed by the service account and appears in Jira under its name; the QAMS audit log records who actually caused it."
                  : " Every transition is attributed to the person whose run caused it. If their Jira credential is missing or expired the sync fails and waits for someone to act on it."}
              </p>
            ) : (
              <p className="muted integrations-said">
                No <code>JIRA_*</code> configuration is present, so no execution will ever contact
                Jira. Issue keys can still be recorded against runs; nothing is sent. See{" "}
                <code>.env.example</code> for the variables and{" "}
                <code>docs/architecture.md</code> for what the sync does once configured.
              </p>
            )}
          </section>

          {/*
            Who has connected — state only. Deliberately no Jira account, email or identity of
            any kind: a Lead needs to know who still has to connect, and never needs to know
            which third-party account someone linked in order to chase them (Q5).
          */}
          <section className="card">
            <div className="panel-head">
              <span className="medallion" aria-hidden>
                <Users size={19} strokeWidth={1.9} aria-hidden />
              </span>
              <div className="panel-head-text">
                <h2>Jira connections</h2>
                <p>Who a transition can be recorded as.</p>
              </div>
            </div>

            <p className="muted integrations-said">
              {roster.connectedCount} of {roster.total} active people have connected their Jira
              account.{" "}
              {jira.serviceAccountFallback
                ? "Runs finalized by anyone else fall back to the service account."
                : "Runs finalized by anyone else cannot sync until they connect."}
            </p>

            {/*
             * A `<ul>` that tiles, where this was `<table className="table">` — a class with no
             * rule anywhere in the stylesheet, so the roster rendered as a bare browser table:
             * no borders, no header treatment, no padding.
             *
             * And a list rather than a fixed table, because two columns is not a table (the rule
             * `.data-table` states is homogeneous data of three or more). One of those two columns
             * was the same state word repeated down the page, which is a list of people with a
             * state each — so the state becomes a chip on the person's row, and the rows tile into
             * however many columns the screen has room for. On a wide screen that shows more of
             * the roster instead of a wider one.
             *
             * The chip is two-state, and deliberately NOT `JiraConnectionPanel`'s three-state one:
             * that panel answers "can MY transitions be recorded as me?", which an unconfigured
             * deployment makes Unavailable. A row here answers "does this person have a credential
             * stored?", which is true or false whatever the environment says. Two questions, and
             * the tone rule is the shared part — `.state-accent`, never `.state-pass`.
             *
             * Alphabetical, as `jiraConnectionRoster` returns them. Not sorted unconnected-first:
             * a Lead also arrives asking about one named person, and a list that reorders itself
             * as people connect is one nobody can find a name in.
             */}
            <ul className="roster">
              {roster.rows.map((row) => (
                <li key={row.userId} className="roster-row">
                  <span className="roster-who">
                    <span className="roster-name">{row.displayName}</span>
                    {/* Already fetched and previously thrown away. It answers the question a
                        Lead asks next about a stale credential — how long has this been in
                        place — and costs no extra read. */}
                    {row.connectedAt ? (
                      <time className="roster-when" dateTime={row.connectedAt.toISOString()}>
                        {formatMinute(row.connectedAt, stampFormat)}
                      </time>
                    ) : null}
                  </span>
                  <span className={row.connected ? "state state-accent" : "state"}>
                    {row.connected ? "Connected" : "Not connected"}
                  </span>
                </li>
              ))}
            </ul>

            <p className="hint">
              People connect their own account from their Account page; it cannot be done for them.
            </p>
          </section>
        </div>

        {/*
          The Lead's OWN connection, the same component `/account` mounts. The screens stay
          split — deployment status is Lead-only, personal connection is not — but a Lead
          looking at this page should not have to go elsewhere to connect themselves. In the
          rail because it is the one panel here that is not about the deployment.
        */}
        <aside className="integrations-rail">
          <JiraConnectionPanel
            connected={mine.connected}
            connectedAt={mine.connectedAt}
            deploymentConfigured={jira.connected}
            serviceAccountFallback={jira.serviceAccountFallback}
            stampFormat={stampFormat}
          />
        </aside>
      </div>
    </div>
  );
}
