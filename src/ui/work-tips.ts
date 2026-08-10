/**
 * The tip the My work rail shows, chosen from the state of the viewer's own queue.
 *
 * ## Why this is contextual rather than a fixed line
 *
 * A panel that always says the same sentence is furniture: it teaches nothing after the
 * first visit and then occupies the rail forever. Each tip below is picked BECAUSE the
 * viewer's queue is currently in the state the tip is about, so the panel is either saying
 * something that applies to a run on screen or it is not there at all.
 *
 * ## Every tip states a documented rule, never advice
 *
 * `CLAUDE.md`: the docs are the source of truth and policy gaps are not filled from general
 * QA practice. So each entry carries the `basis` line it paraphrases, and anything not in
 * the docs — how to prioritise, when to run something, what a good result looks like — is
 * absent on purpose. The two tips with no policy basis describe THIS SCREEN's controls,
 * which is a fact about the software rather than a rule about testing.
 *
 * Pure and free of React, so the wording is unit-testable and the picker cannot quietly
 * start depending on the request.
 */

export type WorkTip = {
  /** Stable across wording changes; only used as a React key. */
  id: string;
  title: string;
  body: string;
  /** An in-app destination, where the tip has an obvious next step. */
  href?: string;
  linkLabel?: string;
  /** The documented line this paraphrases, for review. */
  basis: string;
};

/** What the picker needs to know about the queue it is describing. */
export type WorkTipContext = {
  planned: number;
  inProgress: number;
  /** Whether any unfinished run covers more than one case. */
  hasMultiCaseRun: boolean;
  /** Whether this deployment has Jira configured at all. */
  jiraConfigured: boolean;
  /** Whether any unfinished run is missing its Jira issue key. */
  hasUnlinkedRun: boolean;
};

/**
 * The first tip whose condition holds, most specific first.
 *
 * Ordered by how much the reader is about to need it: a run already in progress is minutes
 * from being finalized, which is the step with the most rules attached and the only one that
 * cannot be undone.
 */
export function pickWorkTip(context: WorkTipContext): WorkTip | null {
  if (context.inProgress > 0) {
    return {
      id: "no-partial-finalize",
      title: "There is no partial finalize",
      body:
        "Finalizing records a result and a non-blank actual result for every case the run covers, in one step. A Fail needs a defect for that case; a Blocked needs a block reason.",
      basis: "business-rules-and-validation.md:28-29"
    };
  }

  if (context.hasMultiCaseRun) {
    return {
      id: "derived-result",
      title: "A run's result is its worst case",
      body:
        "Fail if any case failed, else Blocked if any is blocked, else Pass. The recap spells the split out beside runs covering more than one case.",
      basis: "business-rules-and-validation.md:30"
    };
  }

  if (context.jiraConfigured && context.hasUnlinkedRun) {
    return {
      id: "link-jira",
      title: "Runs can name the Jira issue they test",
      body:
        "Set the issue key when you plan a run, or from the reassignment form while it is still Planned. The search above matches keys, so a ticket in hand finds its runs.",
      basis: "api-and-security.md#Jira execution sync interface"
    };
  }

  if (context.planned === 0 && context.inProgress === 0) {
    return {
      id: "plan-a-run",
      title: "Nothing is assigned to you",
      body:
        "Any role can plan a run against approved test cases and assign it to a tester — including to themselves.",
      href: "/executions/new",
      linkLabel: "Plan a run",
      basis: "roles-workflows.md:13"
    };
  }

  return {
    id: "narrow-the-queue",
    title: "Narrowing the queue",
    body:
      "The product and feature filters scope this list to the runs covering them. The search box matches run IDs, case IDs, case titles and Jira keys.",
    basis: "Describes this screen's own controls; no policy involved."
  };
}
