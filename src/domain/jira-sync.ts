import {
  ExecutionLifecycleState,
  ExecutionOutcome,
  type JiraCommentOutcome,
  type JiraSyncOutcome
} from "@prisma/client";
import { AppError } from "@/lib/errors";

/**
 * The policy that decides when a Jira issue may be transitioned
 * (`docs/architecture.md#Jira execution sync`).
 *
 * Pure and free of Prisma, so the rule that actually matters is testable without a database
 * — the same split `catalogue-tree.ts` and `import-decisions.ts` use. The caller loads the
 * executions sharing an issue key; this decides what that set means.
 *
 * ## Why the trigger is not "an execution finalized"
 *
 * That was the rule as originally requested, and it is wrong for the shape of the data. One
 * Jira task routinely carries several executions — a browser matrix, a re-run after a fix, a
 * regression pass — so finalizing the first of them would move the ticket to Done while the
 * rest have not run. A board that claims work is finished when two thirds of it is
 * outstanding is worse than no integration at all, because people act on it.
 *
 * The issue is therefore transitioned only when EVERY execution carrying its key is
 * Finalized and every one of them derived `PASS`. Finalizing one run is necessary, never
 * sufficient. See [ADR-0003](../../docs/adr/0003-jira-sync-is-decoupled-from-finalize.md).
 *
 * ## Why that is not the whole rule
 *
 * Because it is a property of the KEY rather than of one run, it stays true forever once met,
 * and treating a single past success as "done with this issue" froze the key permanently —
 * see `transitionAlreadyCovers`, which decides whether an eligible issue has anything NEW to
 * report ([ADR-0005](../../docs/adr/0005-a-later-run-transitions-its-issue-again.md)).
 */

/** The only two fields of an execution the rule reads. */
export type SyncCandidate = {
  state: ExecutionLifecycleState;
  /** Derived at finalize; `null` until then. */
  result: ExecutionOutcome | null;
};

/**
 * May the Jira issue be transitioned to its workflow's `done`-category status?
 *
 * `executions` is every execution carrying the issue key — not just the one that finalized.
 *
 * An empty set is `false` rather than vacuously true: no execution carries the key, so
 * nothing has been verified about that issue and there is nothing to report to Jira.
 *
 * A `FINALIZED` row with a `null` result cannot occur through `finalizeExecution`, which
 * always derives one. It is refused anyway — a missing result is an unknown outcome, and an
 * unknown outcome is not a pass.
 */
export function shouldTransitionIssue(executions: SyncCandidate[]): boolean {
  if (executions.length === 0) return false;

  return executions.every(
    (execution) =>
      execution.state === ExecutionLifecycleState.FINALIZED &&
      execution.result === ExecutionOutcome.PASS
  );
}

/** A candidate the caller can also name in a message a person will read. */
export type NamedSyncCandidate = SyncCandidate & { businessId: string };

/**
 * Why `shouldTransitionIssue` said no, in a sentence for the run screen.
 *
 * The rule needs every execution sharing the key, so the answer to "I finalized my run and
 * nothing happened" is almost always a DIFFERENT run — one still open, or one that failed
 * weeks ago. A tester cannot see those from their own run, and until this existed the screen
 * showed nothing at all, so the only way to find out was to read `shouldTransitionIssue`.
 */
export function describeTransitionBlock(executions: NamedSyncCandidate[]): string {
  if (executions.length === 0) {
    // Unreachable from finalize: the run that triggered this carries the key, so it is a
    // member of its own sibling set. Answered rather than left to render as an empty string.
    return "No execution carries this issue key.";
  }

  const open = executions
    .filter((execution) => execution.state !== ExecutionLifecycleState.FINALIZED)
    .map((execution) => execution.businessId);
  const notPassed = executions
    .filter(
      (execution) =>
        execution.state === ExecutionLifecycleState.FINALIZED &&
        execution.result !== ExecutionOutcome.PASS
    )
    .map((execution) => `${execution.businessId} (${execution.result ?? "no result"})`);

  const parts: string[] = [];
  if (open.length > 0) parts.push(`${open.join(", ")} not finalized yet`);
  if (notPassed.length > 0) parts.push(`${notPassed.join(", ")} did not pass`);

  return `Every run on this issue must be finalized and pass before it is transitioned: ${parts.join("; ")}.`;
}

/**
 * Has a successful transition already accounted for every run currently carrying the key?
 *
 * ## Why this replaced "one SUCCEEDED row means never again"
 *
 * That was the original rule, and it is what made a finalize stop moving tickets. Eligibility
 * is a property of the whole key, so once any transition succeeded, EVERY later run on that
 * key was suppressed forever — including a genuine re-test of an issue a person had since
 * moved back to In Progress. The report that found it: an issue was transitioned by one run,
 * moved back by hand, worked on, re-tested by a second run that passed every case, and never
 * moved again. Nothing was recorded, so it read as a broken integration.
 *
 * The rule now asks whether anything has happened SINCE the last successful transition. A run
 * finalized after it is new evidence and earns a fresh transition; a repeat of work already
 * reported does not. That keeps the property the old rule was protecting — one transition per
 * body of work, so a replay cannot re-close a ticket — without freezing the key forever.
 *
 * Re-transitioning an issue already in a done status is a no-op in Jira's own terms: the
 * workflow either offers a transition whose target is that same status, which changes nothing,
 * or offers none at all, which is recorded as a failed attempt with a readable reason
 * (`pickDoneTransition`).
 *
 * A `null` `finalizedAt` counts as NOT covered. It cannot occur on a run that got past
 * `shouldTransitionIssue`, and an unstamped instant is no evidence that the last transition
 * included it — the direction that transitions is the safe one here, because the failure this
 * rule exists to prevent is a ticket that never moves.
 */
export function transitionAlreadyCovers(
  lastSuccessAt: Date | null,
  executions: { finalizedAt: Date | null }[]
): boolean {
  if (lastSuccessAt === null) return false;

  return executions.every(
    (execution) =>
      execution.finalizedAt !== null && execution.finalizedAt.getTime() <= lastSuccessAt.getTime()
  );
}

/**
 * The shape of a Jira issue key — `PROJ-123` (`docs/data-model.md`).
 *
 * Deliberately NOT a member of `BUSINESS_ID_PATTERNS`. Those identify QAMS records, and
 * `CONTEXT.md` defines a business ID as "the human-facing identifier of a record" in this
 * system. A Jira key names a row in someone else's database; conflating the two would put an
 * external format under a constant that means "ours".
 *
 * A Jira project key is at least two characters, starts with a letter, and continues in
 * letters and digits; the issue number is unbounded.
 */
export const JIRA_ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9]+-\d+$/;

/** The documented format, quoted in the error a caller sees. */
const JIRA_ISSUE_KEY_FORMAT = "PROJ-123";

const JIRA_ISSUE_KEY_FIELD = "jiraIssueKey";

/**
 * Trims and validates a supplied issue key, or resolves absence to `null`.
 *
 * Absence is legal and common: an exploratory or ad-hoc run has no Jira task, and an
 * execution without a key simply never talks to Jira. Blank and whitespace-only input are
 * treated as absence rather than rejected, because an empty form field means "none" — not
 * "a malformed key".
 *
 * Only the SHAPE is checked. A well-formed key naming an issue that does not exist in Jira
 * is accepted here on purpose: verifying it would mean calling Jira while planning an
 * execution, which would let a Jira outage block planning — the same coupling
 * `docs/architecture.md#Jira execution sync` refuses at finalize. A key that resolves to
 * nothing surfaces later as a failed sync attempt, where it costs nobody their work.
 */
export function normalizeJiraIssueKey(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;

  const trimmed = raw.trim();
  if (trimmed === "") return null;

  if (!JIRA_ISSUE_KEY_PATTERN.test(trimmed)) {
    throw new AppError(
      422,
      "ID_INVALID",
      `jiraIssueKey must match the documented format ${JIRA_ISSUE_KEY_FORMAT}.`,
      JIRA_ISSUE_KEY_FIELD
    );
  }

  return trimmed;
}

/**
 * Refuses a change to the issue key once the execution has left Planned.
 *
 * The same rule the tester carries (`docs/roles-workflows.md`): settable while the run is
 * still being planned, part of the record once it starts. Without it, a finalized run could
 * be re-pointed at a different Jira issue after the fact, which would make the sync attempt
 * history describe an execution that never tested that issue.
 */
export function ensureIssueKeyMutable(state: ExecutionLifecycleState): void {
  if (state !== ExecutionLifecycleState.PLANNED) {
    throw new AppError(
      422,
      "FORBIDDEN_TRANSITION",
      "jiraIssueKey may only be set or changed while the execution is Planned.",
      JIRA_ISSUE_KEY_FIELD
    );
  }
}

/**
 * How long a transition may take before the caller stops waiting.
 *
 * A finalize request awaits the transport, so an endpoint that HANGS rather than erroring
 * would otherwise hold a tester's response open for the socket timeout — after their work is
 * already committed. A deadline is what keeps "Jira must never cost a tester their work"
 * true against a slow Jira as well as a broken one.
 *
 * The value is deployment configuration (`JIRA_TRANSITION_TIMEOUT_MS`), read through
 * `jiraConfig()`; this module keeps only the type it flows through.
 */

/**
 * What the caller asks the transport to do.
 *
 * `executionId` is optional because a defect transitions its own issue and has no execution
 * (`docs/architecture.md#Jira defect sync`). The transport reads neither it nor `defectId` —
 * both are here so a caller can correlate a request with the row it will write, and so this
 * type says out loud which subjects reach Jira.
 */
export type JiraTransitionRequest = {
  issueKey: string;
  executionId?: string;
  defectId?: string;
  /** The user whose action triggered this; the transport decides whose credential is used. */
  actorId: string;
  /**
   * The transport MUST abandon the attempt after this long and settle, by rejecting or by
   * resolving `FAILED`. A retry picks it up later; blocking the caller is not an option.
   */
  timeoutMs: number;
};

/**
 * What happened. `actorId` is the user whose credential performed the write, or `null` when
 * the service-account fallback did — which is how a reader tells a bot-attributed transition
 * from a human one (`docs/api-and-security.md#Jira execution sync interface`).
 */
export type JiraTransitionResult = {
  outcome: JiraSyncOutcome;
  failureReason?: string;
  actorId?: string | null;
};

/** What the caller asks the transport to post, and where. */
export type JiraCommentRequest = {
  issueKey: string;
  /** Optional for the same reason as on `JiraTransitionRequest`: a defect has no execution. */
  executionId?: string;
  defectId?: string;
  /** The user whose action triggered this; the transport decides whose credential is used. */
  actorId: string;
  /** The finished comment body, in Jira wiki markup (`src/domain/jira-comment.ts`). */
  body: string;
  /**
   * Bounded separately from the transition's deadline rather than sharing one budget with it.
   * The comment is attempted first, so a shared budget would let this — the cosmetic,
   * unretryable half — starve the transition (ADR-0004).
   */
  timeoutMs: number;
};

/**
 * What happened. `commentId` is Jira's id for the comment created, which is the only handle
 * QAMS will ever have on something it wrote into another system.
 */
export type JiraCommentResult = {
  outcome: JiraCommentOutcome;
  commentId?: string | null;
  failureReason?: string;
  actorId?: string | null;
};

/** What the caller asks the transport to raise, and where. */
export type JiraCreateIssueRequest = {
  /** The Jira project the bug is raised in (`JIRA_DEFECT_PROJECT_KEY`). */
  projectKey: string;
  /** The issue type name, `Bug` unless a deployment renamed it. */
  issueType: string;
  summary: string;
  /** The description, in Jira wiki markup (`src/domain/jira-defect.ts`). */
  description: string;
  /**
   * Labels applied to the created issue. One of them ties the issue back to the QAMS defect
   * and is what makes a retry able to recognise its own work (`qamsDefectLabel`).
   */
  labels: string[];
  defectId: string;
  /** The user who raised the defect; the transport decides whose credential is used. */
  actorId: string;
  timeoutMs: number;
};

/**
 * What happened. `issueKey` is the key of the issue now standing for this defect — whether
 * this call created it or found one an earlier attempt had already created.
 *
 * `adopted` says which of those it was. It exists because the two are indistinguishable from
 * the key alone, and a reader looking at a retry that "succeeded" deserves to know whether a
 * second bug was raised or an orphan was reclaimed.
 */
export type JiraCreateIssueResult = {
  outcome: JiraSyncOutcome;
  issueKey?: string | null;
  adopted?: boolean;
  failureReason?: string;
  actorId?: string | null;
};

/**
 * The boundary between this domain and Jira itself.
 *
 * A port, so the rules that decide *whether* to transition an issue and *what* a comment says
 * stay pure and testable while the part that talks to another company's API stays
 * replaceable. Everything above this line is deterministic; everything below it is network
 * I/O.
 */
export type JiraTransport = {
  transitionToDone(request: JiraTransitionRequest): Promise<JiraTransitionResult>;
  postComment(request: JiraCommentRequest): Promise<JiraCommentResult>;
  /**
   * Raise a bug for a defect, or adopt the one an earlier attempt already raised.
   *
   * The adoption is not an optimisation: creation is the one write here that is not
   * idempotent, and the only reason a failed create can be retried at all is that this looks
   * for its own label first (ADR-0006).
   */
  createIssue(request: JiraCreateIssueRequest): Promise<JiraCreateIssueResult>;
};

/**
 * The transport singleton, pinned to `globalThis`.
 *
 * NOT a module-scope `let`, which is what this was and was wrong. Next compiles route
 * handlers (the node layer) and pages/server actions (the react-server layer) into
 * **separate bundles**, and a module imported by both is instantiated **once per bundle** —
 * so a transport installed during startup in one bundle would leave `getJiraTransport()`
 * returning `null` in the other, and finalize would silently never sync on half the entry
 * points. `src/lib/rate-limit.ts` hit exactly this and documents it at length; the fix is
 * the same.
 *
 * Unlike `src/lib/db.ts`, this must NOT be gated on `NODE_ENV`: the bundle split happens in
 * production too, and gating it would fix development while shipping the defect.
 */
declare global {
  var jiraTransportGlobal: JiraTransport | null | undefined;
}

/**
 * Install the transport. Nothing calls this yet.
 *
 * The HTTP implementation is the half of this feature that is NOT built: it needs the Jira
 * OAuth authorization flow, encrypted refresh-token storage, the `done`-status-category
 * transition lookup and a retry worker.
 */
export function setJiraTransport(next: JiraTransport | null): void {
  globalThis.jiraTransportGlobal = next;
}

/**
 * The installed transport, or `null` when Jira is not configured.
 *
 * `null` means the integration is inert: eligibility is still evaluated, but nothing is
 * attempted and no attempt is recorded. Recording an attempt that never happened would put a
 * false row in an append-only table, which is worse than recording nothing.
 */
export function getJiraTransport(): JiraTransport | null {
  return globalThis.jiraTransportGlobal ?? null;
}

/**
 * Strips credential material out of a transport failure before it is stored or audited.
 *
 * `JiraSyncAttempt.failureReason` and its audit event are read by a QA Lead and kept
 * forever, and the string comes from someone else's HTTP client — which routinely embeds the
 * request URL, and sometimes an `Authorization` header, in its error message. The schema
 * comment promised this carries no token material; before this it promised and enforced
 * nothing.
 *
 * `redact()` in `src/lib/logging.ts` cannot help here: it masks forbidden KEYS in an object
 * graph, and this is one flat string.
 *
 * Deliberately blunt. Over-redacting costs a Lead some detail in a failure they will retry
 * anyway; under-redacting writes a bearer token into an append-only table that is never
 * deleted (`docs/api-and-security.md#Authorization and security`).
 */
export function sanitizeFailureReason(raw: string): string {
  return raw
    // `Bearer eyJ…`, `Basic dXNl…` — the header forms.
    .replace(/\b(bearer|basic)\s+[\w\-._~+/=]+/gi, "$1 [REDACTED]")
    // `token=…`, `access_token=…`, `client_secret=…`, `api_key=…` in a query or body.
    .replace(/\b([\w-]*(?:token|secret|password|api[_-]?key))=[^\s&]+/gi, "$1=[REDACTED]")
    // Any query string on a quoted URL. Anchored to `://…?` on purpose: an unanchored `\?`
    // ate ordinary prose, rewriting "Could not resolve site? check the grant" into
    // "Could not resolve site?[REDACTED]" and truncating the reason a Lead needs to read.
    .replace(/(https?:\/\/\S*?\?)\S*/gi, "$1[REDACTED]")
    .slice(0, 500);
}
