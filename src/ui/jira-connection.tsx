import Link from "next/link";
import { PlugZap, Unplug } from "lucide-react";
import { formatMinute, type StampFormat } from "./format";
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
 *
 * ## The two variants
 *
 * `hero` is the band that OPENS `/account`: accent edge, the connection drawn beside it, and
 * the room to say what a connection is for to somebody who has never made one. `card` is the
 * same panel with the decoration off, for `/admin/integrations`, where it sits in the rail
 * beside the deployment's own panels — it is the one thing on that screen that is not about the
 * deployment, and an illustrated band there would make the aside the loudest thing on a screen
 * whose subject is somewhere else. The artwork is also sized as a share of a full-width band
 * (`min(420px, 34%)`), which a 420px rail has no room for.
 *
 * Only presentation differs. The state, the copy and the control are one implementation, so
 * a change to what disconnecting does still lands on both screens at once.
 */
export function JiraConnectionPanel({
  connected,
  connectedAt,
  deploymentConfigured,
  serviceAccountFallback,
  status,
  stampFormat,
  variant = "card"
}: {
  connected: boolean;
  connectedAt: Date | null;
  /** When false, there is nothing to connect TO and the button would only ever fail. */
  deploymentConfigured: boolean;
  serviceAccountFallback: boolean;
  /** The `?jira=` reason from a finished handshake, if this render follows one. */
  status?: string;
  /** How this viewer sees a stamp, from `viewerStampFormat(auth)`. Required, never defaulted. */
  stampFormat: StampFormat;
  /** `hero` opens a screen; `card` sits in a stack of them. Presentation only. */
  variant?: "hero" | "card";
}) {
  /* One value drives the chip, the medallion and the artwork, so they cannot disagree about
     which of the three states this panel is in. "off" covers both "you have not connected"
     and "there is nothing to connect to" — the difference is in the copy, not the drawing. */
  const state = !deploymentConfigured ? "unavailable" : connected ? "on" : "off";

  return (
    <section className={variant === "hero" ? "card hero-panel" : "card"} data-state={state}>
      <div className="hero-body">
        <div className="panel-head">
          <span className="medallion medallion-lg" data-tone={connected ? "pass" : undefined} aria-hidden>
            {connected ? <PlugZap size={22} strokeWidth={1.9} /> : <Unplug size={22} strokeWidth={1.9} />}
          </span>
          <div className="panel-head-text">
            <h2>My Jira connection</h2>
            <p>Who Jira records as the cause of a transition your test runs make.</p>
          </div>
        </div>

        {status ? <JiraStatusNotice status={status} /> : null}

        {!deploymentConfigured ? (
          <>
            <p className="muted">
              Jira is not configured for this deployment, so there is nothing to connect to. Ask
              a QA Lead — this is an environment setting, not something you can change here.
            </p>
            {/* Where the button would be in the other two states, so the chip does not move
                between them. No `.row` around it: the paragraph's own bottom margin is the gap,
                and a flex line holding one chip would be a wrapper for nothing. */}
            <StateChip connected={connected} deploymentConfigured={deploymentConfigured} />
          </>
        ) : connected ? (
          <>
            {/* Through the shared formatter. This used to slice the ISO string to its first
                ten characters, which is the date IN UTC — so a viewer who connected at 07:00
                in Manila was told they had connected the day before (ADR-0007). */}
            {connectedAt ? (
              <dl className="fact-grid hero-facts">
                <div>
                  <dt>Connected on</dt>
                  <dd>
                    <time dateTime={connectedAt.toISOString()}>
                      {formatMinute(connectedAt, stampFormat)}
                    </time>
                  </dd>
                </div>
              </dl>
            ) : null}
            <p className="muted">
              When a run you finalize completes its Jira issue, the transition is made as you.
            </p>
            <div className="row">
              <DisconnectJiraForm />
              <StateChip connected={connected} deploymentConfigured={deploymentConfigured} />
            </div>
            <p className="muted hero-note">
              Disconnecting removes your stored Jira credential.{" "}
              {serviceAccountFallback
                ? "Syncs waiting on it are handed to the service account."
                : "Syncs waiting on it are given up and reported to a QA Lead, because nothing can replay them as you."}
            </p>
          </>
        ) : (
          <>
            <p className="muted">
              Connect your Jira account so transitions caused by your test runs are recorded in
              Jira as you.{" "}
              {serviceAccountFallback
                ? "Until you do, they are made by the service account instead."
                : "Until you do, runs you finalize cannot update Jira at all."}
            </p>
            {/*
              A link, not a button: this is a redirect off-origin to Atlassian's consent screen.

              Opens in a new tab so the consent round trip never takes over the page someone was
              working on. `rel="noopener"` is not optional with `target="_blank"`: without it the
              opened page gets a `window.opener` handle back into this one, and the page we are
              handing control to is a third party's login screen.
            */}
            <div className="row">
              <Link
                className="btn btn-icon"
                href="/api/v1/jira/connect"
                target="_blank"
                rel="noopener noreferrer"
              >
                <PlugZap size={15} strokeWidth={1.9} aria-hidden />
                Connect Jira
              </Link>
              <StateChip connected={connected} deploymentConfigured={deploymentConfigured} />
            </div>
            <p className="muted hero-note">
              Opens Atlassian in a new tab. QAMS never sees your Jira password — only the
              permission you grant it there.
            </p>
          </>
        )}
      </div>

      {variant === "hero" ? <ConnectionArt /> : null}
    </section>
  );
}

/**
 * What state this connection is in, one word.
 *
 * Rendered beside the control that CHANGES the state rather than up in the panel header: the
 * two belong to each other — "Connected" is what the Disconnect button is about to undo — and
 * a chip in the header is read once as decoration and then never again. In the one state with
 * no control to sit beside (nothing configured to connect to) it leads the sentence explaining
 * why, which is the same position relative to the copy.
 *
 * `.state-accent`, never `.state-pass`: the Pass tone is reserved for what policy grades, and
 * a connected integration is not a QA result (DESIGN-SYSTEM.md).
 */
function StateChip({
  connected,
  deploymentConfigured
}: {
  connected: boolean;
  deploymentConfigured: boolean;
}) {
  return (
    <span className={connected ? "state state-accent" : "state"}>
      {connected ? "Connected" : deploymentConfigured ? "Not connected" : "Unavailable"}
    </span>
  );
}

/**
 * Two systems and the link between them, drawn rather than described.
 *
 * Decoration, and nothing but: `aria-hidden`, no text, and every state it reflects is already
 * stated in words beside it. It reads state off the panel's `data-state` in CSS instead of
 * taking a prop, so there is exactly one place that decides which of the three the panel is
 * in. Hidden below the width where it would start squeezing the copy.
 */
function ConnectionArt() {
  return (
    <svg
      className="hero-art"
      viewBox="0 0 208 128"
      width="208"
      height="128"
      role="presentation"
      aria-hidden
      focusable="false"
    >
      <rect className="hero-art-panel" x="1" y="19" width="80" height="90" rx="9" />
      <rect className="hero-art-line" x="13" y="35" width="40" height="5" rx="2.5" />
      <rect className="hero-art-line" x="13" y="49" width="56" height="5" rx="2.5" />
      <rect className="hero-art-line" x="13" y="63" width="34" height="5" rx="2.5" />
      <rect className="hero-art-line" x="13" y="77" width="50" height="5" rx="2.5" />
      <rect className="hero-art-line" x="13" y="91" width="28" height="5" rx="2.5" />

      <rect className="hero-art-panel" x="127" y="19" width="80" height="90" rx="9" />
      <rect className="hero-art-line" x="139" y="35" width="46" height="5" rx="2.5" />
      <rect className="hero-art-line" x="139" y="49" width="30" height="5" rx="2.5" />
      <rect className="hero-art-line" x="139" y="63" width="52" height="5" rx="2.5" />
      <rect className="hero-art-line" x="139" y="77" width="38" height="5" rx="2.5" />
      <rect className="hero-art-line" x="139" y="91" width="44" height="5" rx="2.5" />

      <path className="hero-art-link" d="M81 64 H127" />
      <circle className="hero-art-node" cx="104" cy="64" r="15" />
      <path className="hero-art-tick" d="M97.5 64 l4.5 4.5 L111 59.5" />
    </svg>
  );
}

/**
 * Turns the `?jira=` reason into a sentence.
 *
 * The reasons are deliberately coarse. A callback failure knows exactly what went wrong —
 * forged state, expired state, a state belonging to someone else — and says none of it here:
 * the detail is in the server log for a QA Lead, because a precise message would tell an
 * attacker which part of their attempt failed.
 *
 * A finished handshake is reported calmly and a failed one in the failure tone — the same
 * split `FormNotice` makes. Every one of these used to render red, so the sentence confirming
 * a connection had just been made arrived looking like the news that it had not.
 */
function JiraStatusNotice({ status }: { status: string }) {
  const outcome: { message: string; done: boolean } | null =
    status === "connected"
      ? { message: "Your Jira account is connected.", done: true }
      : status === "disconnected"
        ? { message: "Your Jira account has been disconnected.", done: true }
        : status === "denied"
          ? { message: "Jira did not approve the connection. Nothing was changed.", done: false }
          : status === "unconfigured"
            ? { message: "Jira is not configured for this deployment. Ask a QA Lead.", done: false }
            : status === "exchange"
              ? {
                  message:
                    "Jira could not complete the connection. Try again; if it keeps failing, a QA Lead can see why in the logs.",
                  done: false
                }
              : status === "invalid"
                ? {
                    message:
                      "That connection attempt could not be verified, so nothing was changed. Start again from this page.",
                    done: false
                  }
                : null;

  if (outcome === null) return null;

  return (
    <div className={outcome.done ? "notice notice-advisory" : "notice"} role="status">
      <span>{outcome.message}</span>
    </div>
  );
}
