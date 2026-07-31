/**
 * Shown inside the shell while a screen's server render is in flight — every page
 * here is `force-dynamic`, so without this a click gives no feedback until the data
 * arrives. Deliberately quiet: a sentence, not a spinner theatre.
 */
export default function Loading() {
  return (
    <p className="muted" role="status" aria-live="polite">
      Loading…
    </p>
  );
}
