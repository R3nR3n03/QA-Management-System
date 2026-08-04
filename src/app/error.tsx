"use client";

import Link from "next/link";

/**
 * The route error boundary. The thrown error is NOT rendered — same rule as
 * `asErrorResponse`: no stack traces or internals reach a user
 * (`docs/api-and-security.md:33`). The digest is shown instead, because Next writes
 * it to the server log with the real error, so a report quoting it can be tied to a
 * log line the same way an INTERNAL_ERROR requestId can.
 *
 * Not "global": `app/error.tsx` does not catch failures in the root layout — that would
 * be `global-error.tsx`, which this project does not have. It replaces the page BELOW
 * `(app)/layout.tsx`, which is why it needs its own way out (see below).
 */
export default function RouteError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    /*
      A <div>, not a <main>: this renders inside `(app)/layout.tsx`, which already
      provides `<main id="main">`, and two main landmarks on one page leaves a screen
      reader with no unambiguous "the content" to jump to.
    */
    <div style={{ minHeight: "60vh", display: "grid", placeItems: "center", padding: "var(--sp-5)" }}>
      <div className="card" style={{ maxWidth: 460, textAlign: "center" }}>
        <h1 style={{ fontSize: 20 }}>Something broke on our side</h1>
        <p style={{ margin: "0 auto var(--sp-3)" }}>
          Your data is safe — nothing was saved by a request that fails this way. Try again; if it
          keeps happening, report it with the reference below.
        </p>
        {error.digest ? (
          <p className="bid" style={{ marginBottom: "var(--sp-4)" }}>Reference {error.digest}</p>
        ) : null}
        <div className="row" style={{ justifyContent: "center" }}>
          <button className="btn" type="button" onClick={reset}>
            Try again
          </button>
          {/* For a DETERMINISTIC failure — a bad query string, an invariant on this one
              record — "Try again" re-renders the same failing tree forever. The boundary
              has replaced the screen, so there is no rail to navigate away with either.
              `not-found.tsx` already offers a way out; this had none. */}
          <Link className="btn btn-secondary" href="/my-work">
            Go to my work
          </Link>
        </div>
      </div>
    </div>
  );
}
