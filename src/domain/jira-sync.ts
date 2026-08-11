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

/** What the caller asks the transport to do. */
export type JiraTransitionRequest = {
  issueKey: string;
  executionId: string;
  /** The user whose run triggered this; the transport decides whose credential is used. */
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
  executionId: string;
  /** The user whose run finalized; the transport decides whose credential is used. */
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
