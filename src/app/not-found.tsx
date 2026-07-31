import Link from "next/link";

/**
 * The styled 404. Reached both for unknown URLs and for `notFound()` calls — which
 * includes lead-only screens viewed by other roles, so the copy stays neutral: it
 * never confirms whether the address exists for someone else.
 */
export default function NotFound() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "var(--sp-5)" }}>
      <div className="card" style={{ maxWidth: 420, textAlign: "center" }}>
        <p className="bid" style={{ marginBottom: "var(--sp-2)" }}>404</p>
        <h1 style={{ fontSize: 20 }}>There is nothing at this address</h1>
        <p style={{ margin: "0 auto var(--sp-4)" }}>
          The record may have never existed, or the link may be out of date.
        </p>
        <Link className="btn" href="/my-work">
          Back to my work
        </Link>
      </div>
    </main>
  );
}
