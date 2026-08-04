/**
 * Shape-of-the-page skeleton shown while a screen's server render is in flight —
 * every screen here is `force-dynamic`, so without this a click gives no feedback
 * until the data arrives. A heading bar, a sentence, and a record list: the silhouette
 * most screens resolve into. The shimmer collapses under prefers-reduced-motion with
 * every other animation.
 *
 * The announcement is TEXT, not `aria-label`. A live region announces its text content;
 * an `aria-label` supplies an accessible name, which is not the same thing — the region
 * held nothing but text-free skeleton divs, so sighted users got a shimmer and screen
 * reader users got silence for the whole round trip. The skeletons are hidden from
 * assistive tech besides, or they sit in the tree as a run of empty generics.
 */
export default function Loading() {
  return (
    <div role="status">
      <span className="sr-only">Loading…</span>
      <div aria-hidden="true">
        <div
          className="skeleton"
          style={{ width: 220, height: 28, marginBottom: "var(--sp-3)" }}
        />
        <div
          className="skeleton"
          style={{ width: 340, height: 14, marginBottom: "var(--sp-5)" }}
        />
        <div className="card card-flush">
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row} className="list-row">
              <div className="skeleton" style={{ width: 90, height: 14 }} />
              <div className="skeleton" style={{ flex: "1 1 200px", height: 14 }} />
              <div className="skeleton" style={{ width: 56, height: 22 }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
