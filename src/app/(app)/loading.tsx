/**
 * Shape-of-the-page skeleton shown while a screen's server render is in flight —
 * every screen here is `force-dynamic`, so without this a click gives no feedback
 * until the data arrives. A heading bar, a sentence, and a record list: the silhouette
 * most screens resolve into. `role="status"` announces loading once to screen
 * readers; the shimmer collapses under prefers-reduced-motion with every other
 * animation.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading">
      <div className="skeleton" style={{ width: 220, height: 28, marginBottom: 12 }} />
      <div className="skeleton" style={{ width: 340, height: 14, marginBottom: 24 }} />
      <div className="card" style={{ padding: 0 }}>
        {[0, 1, 2, 3, 4].map((row) => (
          <div key={row} className="list-row">
            <div className="skeleton" style={{ width: 90, height: 14 }} />
            <div className="skeleton" style={{ flex: "1 1 200px", height: 14 }} />
            <div className="skeleton" style={{ width: 56, height: 22 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
