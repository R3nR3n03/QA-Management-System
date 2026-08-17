import { Clock3, LockKeyhole } from "lucide-react";
import { profile } from "@/domain/auth";
import { jiraConnectionFor } from "@/domain/jira-credentials";
import { organizationTimeZone } from "@/lib/app-config";
import { jiraConnectionStatus } from "@/lib/jira-config";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import { timeZoneChoices, UTC } from "@/lib/time-zone";
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
 *
 * ## The shape of the screen
 *
 * A connection band, then the two settings side by side. The three panels used to be a
 * single 480px column of stacked `<h2>` + card, which put "Change password" — the one thing
 * most people open this screen to do — below the fold on a laptop, under a form about
 * timestamps. They are peers, so they are laid out as peers; the band leads because it is the
 * only one of the three that reports a STATE rather than offering a setting.
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
  // One instant for the whole render: the zone labels and the preview specimen are two views
  // of the same moment, and reading the clock twice could put them a DST boundary apart.
  const now = new Date();

  return (
    /* The wrapper is the width opt-in: `.shell-main:has(.acct-screen)` widens the column to
       1440px, the same escape hatch My work uses, and the flex gap gives the three panels one
       vertical rhythm instead of each carrying its own margin. */
    <div className="acct-screen">
      <div className="page-head">
        <div className="page-head-text">
          <h1>My account</h1>
          <p className="muted">
            For <strong className="acct-who">{me?.email}</strong>
            {me ? ` · ${me.displayName}` : ""}. Accounts and roles are managed by the QA Lead.
          </p>
        </div>
        {/* The role, stated as the chip it is everywhere else. `.state-accent` and not a
            graded tone: a role is an attribute, not an outcome (DESIGN-SYSTEM.md). */}
        {me ? <span className="state state-accent">{roleLabel(me.role)}</span> : null}
      </div>

      <JiraConnectionPanel
        variant="hero"
        connected={jira.connected}
        connectedAt={jira.connectedAt}
        deploymentConfigured={deployment.connected}
        serviceAccountFallback={deployment.serviceAccountFallback}
        status={jiraStatus}
        stampFormat={viewerStampFormat(auth)}
      />

      <div className="acct-grid">
        <section className="card">
          <div className="panel-head">
            <span className="medallion" aria-hidden>
              <Clock3 size={19} strokeWidth={1.9} />
            </span>
            <div className="panel-head-text">
              <h2>How times are shown</h2>
              <p>Your zone and clock, applied to every stamp you are shown.</p>
            </div>
          </div>
          <DisplayPreferencesForm
            timeZone={me?.timeZone ?? null}
            hourFormat={me?.hourFormat ?? null}
            zones={timeZoneChoices(now)}
            organizationZone={organizationTimeZone() ?? UTC}
            nowIso={now.toISOString()}
          />
        </section>

        <section className="card">
          <div className="panel-head">
            <span className="medallion" data-tone="blocked" aria-hidden>
              <LockKeyhole size={19} strokeWidth={1.9} />
            </span>
            <div className="panel-head-text">
              <h2>Change password</h2>
              <p>Only you can change it, and only with the current one.</p>
            </div>
          </div>
          {/* The floor comes from the module that enforces it rather than being restated
              here: `password.ts` is deployment default, not policy, and the day a QA Lead
              approves a real one the copy must move with it. */}
          <ChangePasswordForm minLength={MIN_PASSWORD_LENGTH} />
        </section>
      </div>
    </div>
  );
}
