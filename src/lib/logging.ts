/**
 * Structured request logging.
 *
 * `docs/architecture.md:47` requires: "Capture structured logs with request ID,
 * actor ID, action, outcome, and error code; never log credentials or evidence
 * contents." Nothing implemented it, so every 500 was invisible — `asErrorResponse`
 * (`src/lib/errors.ts:44`) discards the caught error and returns "Unexpected error."
 * with a `requestId` that correlated with nothing.
 *
 * This is OPERATIONAL history and is not a substitute for the audit log. `AuditEvent`
 * records what the business did and is append-only, immutable and queryable
 * (`docs/business-rules-and-validation.md:50`). This records what the process did, is
 * written to stdout, and is disposable. Neither replaces the other.
 *
 * `buildLogRecord` and `redact` are pure so they can be unit-tested without a
 * database, a server, or captured console output. Only `logRequest` touches the
 * outside world.
 *
 * One line of JSON per request, to stdout. No dependency, no transport, no
 * configuration — a deployment platform collects stdout, and choosing an aggregator
 * is a deployment decision this repository does not get to make.
 */

export type LogOutcome = "ok" | "client_error" | "server_error";

export type LogRecord = {
  occurredAt: string;
  level: "info" | "warn" | "error";
  requestId: string;
  outcome: LogOutcome;
  status: number;
  method?: string;
  path?: string;
  /** Absent when the request failed before authentication. */
  actorId?: string;
  /** The domain action, where the caller knows it (e.g. "EXECUTION_FINALIZED"). */
  action?: string;
  /** The stable ErrorCode, on any non-ok outcome. */
  errorCode?: string;
  /** Developer-facing message. Never the user-facing copy, never a request body. */
  message?: string;
  /** Wall-clock duration, where the caller measured it. */
  durationMs?: number;
  /** Only ever populated for server_error. Never sent to a client. */
  stack?: string;
};

/**
 * Keys whose values must never reach a log, matched case-insensitively as a
 * substring. `docs/architecture.md:47` forbids credentials and evidence contents;
 * `docs/data-model.md:35` forbids `passwordHash` reaching any log.
 *
 * This is a denylist, which is the weaker of the two designs. It is here as a
 * backstop only: the call sites below never pass a request body in the first place,
 * which is the actual protection. Do not start relying on this to sanitise
 * arbitrary objects.
 */
const FORBIDDEN_KEY_PARTS = [
  "password",
  "secret",
  "token",
  "cookie",
  "authorization",
  "credential",
  "sessionvalue",
  "evidence"
];

const REDACTED = "[redacted]";

function isForbiddenKey(key: string): boolean {
  const lowered = key.toLowerCase();
  return FORBIDDEN_KEY_PARTS.some((part) => lowered.includes(part));
}

/**
 * Recursively replaces the value of any forbidden key with `[redacted]`. Cycles are
 * broken rather than thrown on, because a logger must never be the thing that takes
 * a request down.
 */
export function redact(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value as object)) return "[circular]";
  seen.add(value as object);

  if (Array.isArray(value)) return value.map((item) => redact(item, seen));

  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isForbiddenKey(key) ? REDACTED : redact(inner, seen);
  }
  return out;
}

export type LogInput = {
  occurredAt: string;
  requestId: string;
  status: number;
  method?: string;
  path?: string;
  actorId?: string;
  action?: string;
  errorCode?: string;
  message?: string;
  durationMs?: number;
  stack?: string;
};

/**
 * Derives outcome and level from the status, and drops every undefined field so the
 * emitted JSON stays narrow. The timestamp is an input rather than read from the
 * clock, so this stays deterministic and testable.
 */
export function buildLogRecord(input: LogInput): LogRecord {
  const outcome: LogOutcome =
    input.status >= 500 ? "server_error" : input.status >= 400 ? "client_error" : "ok";
  const level = outcome === "server_error" ? "error" : outcome === "client_error" ? "warn" : "info";

  const record: LogRecord = {
    occurredAt: input.occurredAt,
    level,
    requestId: input.requestId,
    outcome,
    status: input.status
  };

  if (input.method) record.method = input.method;
  if (input.path) record.path = input.path;
  if (input.actorId) record.actorId = input.actorId;
  if (input.action) record.action = input.action;
  if (input.errorCode) record.errorCode = input.errorCode;
  if (input.message) record.message = input.message;
  if (typeof input.durationMs === "number") record.durationMs = input.durationMs;
  // A stack is diagnostic gold on a 500 and noise everywhere else. It is never
  // returned to a client -- docs/api-and-security.md:33 forbids exposing stack traces.
  if (input.stack && outcome === "server_error") record.stack = input.stack;

  return record;
}

/**
 * Emits one JSON line. Deliberately swallows its own failures: a logger that throws
 * turns a handled 422 into an unhandled 500, which is strictly worse than losing a
 * log line.
 */
export function logRequest(input: LogInput): void {
  try {
    const record = buildLogRecord(input);
    console.log(JSON.stringify(redact(record)));
  } catch {
    // Intentionally empty. See above.
  }
}

/**
 * Strips a URL down to method and pathname for logging.
 *
 * Query strings are dropped wholesale. `GET /release-readiness` carries productId,
 * release and environment, none of which is sensitive today — but a denylist over
 * future query parameters is a bet this module should not take, and the path alone
 * is enough to correlate with the requestId in the error body.
 */
export function requestTarget(request: { method?: string; url?: string }): {
  method?: string;
  path?: string;
} {
  const method = request.method;
  if (!request.url) return { method };
  try {
    return { method, path: new URL(request.url).pathname };
  } catch {
    return { method };
  }
}
