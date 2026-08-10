/**
 * Choosing which Jira transition means "done".
 *
 * Pure, and separated from the HTTP client because this is the one decision in the transport
 * that can be wrong in an interesting way — everything else is a request.
 *
 * ## Why category and not name
 *
 * Jira has no operation that sets a status: you execute a transition, and a workflow may
 * refuse one that is illegal from the issue's current status. Choosing the transition called
 * `"Done"` breaks on renaming, on localisation, and on every team that says "Complete",
 * "Closed" or "Shipped". Every Jira status belongs to one of three fixed **status
 * categories** — `new`, `indeterminate`, `done` — and that classification is a Jira
 * primitive rather than user-editable text.
 *
 * So: pick a transition whose TARGET status is in the `done` category.
 */

/** The shape Jira returns from `GET /rest/api/3/issue/{key}/transitions`. */
export type JiraTransition = {
  id: string;
  name: string;
  to: {
    name: string;
    statusCategory: { key: string };
  };
};

/** Jira's fixed key for the completed category. */
const DONE_CATEGORY = "done";

/**
 * The transition id to execute, or `null` when this workflow offers no way to complete the
 * issue from where it currently is.
 *
 * `null` is a legitimate outcome, not an error: a workflow may simply not allow the current
 * status to reach a done status directly. The caller records that as a failed attempt with a
 * readable reason rather than pretending it succeeded.
 *
 * `overrideId` is the per-project deployment setting (`JIRA_TRANSITION_OVERRIDE_<KEY>`). It
 * is honoured only when the workflow actually offers it — an override naming a transition
 * that is not currently legal is ignored rather than sent, because Jira would reject it and
 * the fall-back-to-category answer is almost certainly what was wanted.
 *
 * Defensive about the payload: this is another company's JSON, and one malformed entry in a
 * list should not take down a sync.
 */
export function pickDoneTransition(
  transitions: JiraTransition[],
  overrideId?: string | null
): string | null {
  const usable = transitions.filter(
    (transition) => transition && typeof transition.id === "string" && transition.to?.statusCategory?.key
  );

  if (overrideId) {
    const configured = usable.find((transition) => transition.id === overrideId);
    if (configured) return configured.id;
  }

  const done = usable.find((transition) => transition.to.statusCategory.key === DONE_CATEGORY);
  return done ? done.id : null;
}
