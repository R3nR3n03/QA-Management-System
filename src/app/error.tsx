"use client";

/**
 * The global error boundary. The thrown error is NOT rendered — same rule as
 * `asErrorResponse`: no stack traces or internals reach a user
 * (`docs/api-and-security.md:33`). The digest is shown instead, because Next writes
 * it to the server log with the real error, so a report quoting it can be tied to a
 * log line the same way an INTERNAL_ERROR requestId can.
 */
export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main style={{ minHeight: "60vh", display: "grid", placeItems: "center", padding: "var(--sp-5)" }}>
      <div className="card" style={{ maxWidth: 460, textAlign: "center" }}>
        <h1 style={{ fontSize: 20 }}>Something broke on our side</h1>
        <p style={{ margin: "0 auto var(--sp-3)" }}>
          Your data is safe — nothing was saved by a request that fails this way. Try again; if it
          keeps happening, report it with the reference below.
        </p>
        {error.digest ? (
          <p className="bid" style={{ marginBottom: "var(--sp-4)" }}>Reference {error.digest}</p>
        ) : null}
        <button className="btn" type="button" onClick={reset}>
          Try again
        </button>
      </div>
    </main>
  );
}
