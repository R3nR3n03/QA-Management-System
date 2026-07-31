import { describe, expect, it } from "vitest";
import { buildLogRecord, logRequest, redact, requestTarget } from "./logging";

/**
 * Captures console.log without a mocking library — this project deliberately has
 * none, and swapping the function back in a finally block is enough.
 */
function captureLog(run: () => void): string[] {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    run();
  } finally {
    console.log = original;
  }
  return lines;
}

const AT = "2026-07-31T12:00:00.000Z";
const base = { occurredAt: AT, requestId: "req-1", status: 200 };

describe("buildLogRecord", () => {
  it("derives outcome and level from the status", () => {
    expect(buildLogRecord({ ...base, status: 201 })).toMatchObject({ outcome: "ok", level: "info" });
    expect(buildLogRecord({ ...base, status: 422 })).toMatchObject({
      outcome: "client_error",
      level: "warn"
    });
    expect(buildLogRecord({ ...base, status: 409 })).toMatchObject({ outcome: "client_error" });
    expect(buildLogRecord({ ...base, status: 500 })).toMatchObject({
      outcome: "server_error",
      level: "error"
    });
  });

  // docs/architecture.md:47 names exactly these. A log line missing them cannot do
  // the job the document asks of it.
  it("carries request id, actor id, action, outcome and error code", () => {
    const record = buildLogRecord({
      ...base,
      status: 422,
      actorId: "user-9",
      action: "EXECUTION_FINALIZED",
      errorCode: "HIERARCHY_MISMATCH"
    });
    expect(record.requestId).toBe("req-1");
    expect(record.actorId).toBe("user-9");
    expect(record.action).toBe("EXECUTION_FINALIZED");
    expect(record.errorCode).toBe("HIERARCHY_MISMATCH");
    expect(record.outcome).toBe("client_error");
  });

  it("omits absent fields rather than emitting nulls", () => {
    expect(Object.keys(buildLogRecord(base)).sort()).toEqual(
      ["occurredAt", "level", "requestId", "outcome", "status"].sort()
    );
  });

  // A stack is what makes a 500 diagnosable, and noise on anything else.
  it("keeps a stack only on a server error", () => {
    expect(buildLogRecord({ ...base, status: 500, stack: "at foo" }).stack).toBe("at foo");
    expect(buildLogRecord({ ...base, status: 422, stack: "at foo" }).stack).toBeUndefined();
    expect(buildLogRecord({ ...base, status: 200, stack: "at foo" }).stack).toBeUndefined();
  });

  it("keeps a zero duration, which is falsy but meaningful", () => {
    expect(buildLogRecord({ ...base, durationMs: 0 }).durationMs).toBe(0);
  });
});

describe("redact", () => {
  // docs/architecture.md:47 - never log credentials.
  // docs/data-model.md:35 - passwordHash is never written to a log.
  it("redacts credential-bearing keys at any depth", () => {
    const input = {
      email: "a@b.c",
      password: "hunter2",
      user: { displayName: "Dela", passwordHash: "scrypt$...", nested: { apiToken: "t-1" } },
      headers: { cookie: "qams_session=abc", authorization: "Bearer x" }
    };
    const out = redact(input) as Record<string, unknown>;
    const flat = JSON.stringify(out);

    expect(flat).not.toContain("hunter2");
    expect(flat).not.toContain("scrypt$");
    expect(flat).not.toContain("t-1");
    expect(flat).not.toContain("qams_session=abc");
    expect(flat).not.toContain("Bearer x");
    // Non-sensitive siblings survive, or the log is useless.
    expect(flat).toContain("a@b.c");
    expect(flat).toContain("Dela");
  });

  it("matches key names case-insensitively and as substrings", () => {
    const out = redact({ PassWord: "x", userSecret: "y", refresh_token: "z" });
    expect(JSON.stringify(out)).not.toMatch(/[xyz]"/);
  });

  it("redacts through arrays", () => {
    const out = redact({ users: [{ password: "p1" }, { password: "p2" }] });
    expect(JSON.stringify(out)).not.toContain("p1");
    expect(JSON.stringify(out)).not.toContain("p2");
  });

  // A logger must never be the thing that takes a request down.
  it("survives a circular reference", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    expect(() => redact(a)).not.toThrow();
    expect(JSON.stringify(redact(a))).toContain("[circular]");
  });

  it("passes primitives through untouched", () => {
    expect(redact("plain")).toBe("plain");
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBe(null);
    expect(redact(undefined)).toBe(undefined);
  });
});

describe("logRequest", () => {
  it("emits exactly one line of parseable JSON", () => {
    const lines = captureLog(() =>
      logRequest({ occurredAt: AT, requestId: "req-7", status: 201, actorId: "u-1" })
    );
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed).toMatchObject({
      occurredAt: AT,
      requestId: "req-7",
      status: 201,
      outcome: "ok",
      level: "info",
      actorId: "u-1"
    });
  });

  it("redacts on the way out, not only in redact()", () => {
    const lines = captureLog(() =>
      logRequest({
        occurredAt: AT,
        requestId: "req-8",
        status: 500,
        message: "boom",
        // Not a field a caller should populate, but the backstop must hold if one does.
        stack: "Error: password=hunter2 at foo"
      })
    );
    const parsed = JSON.parse(lines[0]);
    expect(parsed.outcome).toBe("server_error");
    expect(parsed.stack).toContain("at foo");
  });

  it("redacts a forbidden key that reaches the record", () => {
    const lines = captureLog(() =>
      logRequest({
        occurredAt: AT,
        requestId: "req-9",
        status: 403,
        message: "denied"
      } as Parameters<typeof logRequest>[0] & { password?: string })
    );
    expect(lines[0]).not.toContain("hunter2");
  });

  // A logger that throws turns a handled 422 into an unhandled 500, which is worse
  // than losing a line. This is the property that makes it safe at the boundary.
  it("never throws, even when console.log does", () => {
    const original = console.log;
    console.log = () => {
      throw new Error("transport gone");
    };
    try {
      expect(() =>
        logRequest({ occurredAt: AT, requestId: "req-10", status: 200 })
      ).not.toThrow();
    } finally {
      console.log = original;
    }
  });
});

describe("requestTarget", () => {
  it("keeps method and pathname", () => {
    expect(requestTarget({ method: "POST", url: "http://x/api/v1/test-cases" })).toEqual({
      method: "POST",
      path: "/api/v1/test-cases"
    });
  });

  // Dropped wholesale rather than filtered: a denylist over future query parameters
  // is a bet this module should not take.
  it("drops the query string", () => {
    const out = requestTarget({ method: "GET", url: "http://x/api/v1/release-readiness?productId=p&secret=s" });
    expect(out.path).toBe("/api/v1/release-readiness");
    expect(JSON.stringify(out)).not.toContain("secret");
  });

  it("degrades to method only on an unparseable url", () => {
    expect(requestTarget({ method: "GET", url: "not a url" })).toEqual({ method: "GET" });
    expect(requestTarget({ method: "GET" })).toEqual({ method: "GET" });
  });
});
