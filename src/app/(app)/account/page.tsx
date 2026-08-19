import { Clock3, LockKeyhole, UserRound } from "lucide-react";
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
 * A connection band, then the two settings side by side, with who-you-are and how-the-app-treats-
 * you in a rail beside them. The three panels used to be a single 480px column of stacked `<h2>` +
 * card, which put "Change password" — the one thing most people open this screen to do — below the
 * fold on a laptop, under a form about timestamps. They are peers, so they are laid out as peers;
 * the band leads because it is the only one of the three that reports a STATE rather than offering
 * a setting.
 *
 * ## Taking the width without widening the controls
 *
 * The screen is uncapped now (`.shell-main:has(.acct-screen)`), where it stood at 1440px on the
 * argument that a wider form is a worse form. That argument was right about the CONTROLS and wrong
 * as a reason to cap the page: the fix is to cap the controls, which `.settings-cols` now does —
 * its tracks stop at 380px — so a wider card spends the extra on nothing rather than on a 520px
 * `<select>`.
 *
 * With that in place the width can go somewhere useful, and this rail is what it goes to. It also
 * gives the identity a home: it was a muted run-on sentence, then a block in the header's corner,
 * and neither had room for the thing this screen was never saying — that a preference nobody has
 * set is INHERITED, and from a different place for the zone than for the clock (ADR-0007).
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
  // What every stamp on every screen is actually drawn with, after the fallbacks — which is the
  // pair the rail reports. Resolved once, and the same call every other screen makes.
  const stampFormat = viewerStampFormat(auth);

  return (
    /* The wrapper is the width opt-in, and the flex gap gives the head, the columns and
       everything in them one vertical rhythm instead of each carrying its own margin. */
    <div className="acct-screen">
      <div className="page-head">
        <div className="page-head-text">
          <h1>My account</h1>
          <p className="page-banner-lede">
            Accounts and roles are managed by the QA Lead. What you can change here is your
            password, and how times are shown to you.
          </p>
        </div>
      </div>

      {/* One grid, two shapes. Below 1400px it is a single column and the rail becomes the last
          card in the stack; above it, the rail moves beside the work. That threshold is arithmetic
          — the two setting cards, the rail's floor, the gap and the shell's own sidebar add up to
          1324px — and it is only that low because the control tracks are capped; see `.acct-cols`.
          Source order is the work first, the rail last, the same order `.work-screen` keeps and for
          the same reason: on a narrow screen nobody wants a summary above the forms. */}
      <div className="acct-cols">
        <div className="acct-main">
          <JiraConnectionPanel
            variant="hero"
            connected={jira.connected}
            connectedAt={jira.connectedAt}
            deploymentConfigured={deployment.connected}
            serviceAccountFallback={deployment.serviceAccountFallback}
            status={jiraStatus}
            stampFormat={stampFormat}
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

        {/*
         * Who the system thinks you are, and how it is treating you as a result.
         *
         * `profile` returns null only for a session whose user has gone, which `requireSession`
         * makes very nearly unreachable — so the panel is absent rather than half-drawn, and the
         * settings beside it still work.
         */}
        {me ? (
          <aside className="acct-rail">
            <section className="card acct-me">
              <div className="panel-head">
                <span className="medallion medallion-lg" aria-hidden>
                  <UserRound size={22} strokeWidth={1.9} />
                </span>
                <div className="panel-head-text">
                  <div className="cluster">
                    <h2>{me.displayName}</h2>
                    {/* The role, stated as the chip it is everywhere else. `.state-accent` and
                        not a graded tone: a role is an attribute, not an outcome
                        (DESIGN-SYSTEM.md). */}
                    <span className="state state-accent">{roleLabel(me.role)}</span>
                  </div>
                  {/* The address the account is keyed by, and the one fact here a person came to
                      check. Monospaced so it can be compared character by character. */}
                  <p className="acct-who">{me.email}</p>
                </div>
              </div>

              {/*
               * The pair every stamp on every screen is actually drawn with, AFTER the fallbacks
               * — and where each one came from, which is the thing this screen has never said.
               *
               * The two inherit from different places, and ADR-0007 is explicit about why: a
               * viewer who has chosen no zone is served by the deployment's own, because a Jira
               * comment needs an organization zone anyway; the clock has no such middle step,
               * since Jira is fixed at 24-hour and no deployment-level value exists to fall
               * through to. So `null` zone reads "the organization's" and `null` clock reads "the
               * application default" — never the same sentence, because they are not the same
               * fact. The form beside this one sets them; this says what is in force.
               */}
              <h3>How stamps reach you</h3>
              <dl className="fact-grid acct-effective">
                <div>
                  <dt>Time zone</dt>
                  <dd>
                    {stampFormat.timeZone}
                    <span className="acct-source">
                      {me.timeZone === null ? "The organization’s zone" : "Your choice"}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Clock</dt>
                  <dd>
                    {stampFormat.clock === "h12" ? "12-hour" : "24-hour"}
                    <span className="acct-source">
                      {me.hourFormat === null ? "The application default" : "Your choice"}
                    </span>
                  </dd>
                </div>
              </dl>
            </section>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
