import { describe, expect, it } from "vitest";
import { pickWorkTip, type WorkTipContext } from "./work-tips";

/**
 * The tip picker. Pure, so these are about which rule surfaces when — and about the one
 * property the copy must hold: every tip states something the docs establish, so none of
 * them may drift into advice the knowledge base does not give.
 */

const EMPTY: WorkTipContext = {
  planned: 0,
  inProgress: 0,
  hasMultiCaseRun: false,
  jiraConfigured: false,
  hasUnlinkedRun: false
};

describe("pickWorkTip", () => {
  it("leads with finalization once a run is in progress", () => {
    // The step with the most rules attached and the only one that cannot be undone, so it
    // outranks every other tip the queue could earn.
    const tip = pickWorkTip({ ...EMPTY, planned: 4, inProgress: 1, hasMultiCaseRun: true });
    expect(tip?.id).toBe("no-partial-finalize");
  });

  it("explains the derived result when a visible run covers several cases", () => {
    const tip = pickWorkTip({ ...EMPTY, planned: 2, hasMultiCaseRun: true });
    expect(tip?.id).toBe("derived-result");
    expect(tip?.basis).toBe("business-rules-and-validation.md:30");
  });

  it("mentions Jira only where the deployment has it and a run is unlinked", () => {
    expect(pickWorkTip({ ...EMPTY, planned: 1, jiraConfigured: true, hasUnlinkedRun: true })?.id).toBe(
      "link-jira"
    );
    // Configured, but every run already carries a key: nothing to say.
    expect(pickWorkTip({ ...EMPTY, planned: 1, jiraConfigured: true })?.id).toBe("narrow-the-queue");
    // Unlinked runs, but no Jira in this deployment — the tip would describe a feature that
    // is switched off, which is the same trap "No Jira issue" avoids on the rows.
    expect(pickWorkTip({ ...EMPTY, planned: 1, hasUnlinkedRun: true })?.id).toBe("narrow-the-queue");
  });

  it("points an empty queue at planning, with somewhere to go", () => {
    const tip = pickWorkTip(EMPTY);
    expect(tip?.id).toBe("plan-a-run");
    expect(tip?.href).toBe("/executions/new");
    expect(tip?.linkLabel).toBe("Plan a run");
  });

  it("always has something to show, and always cites its source", () => {
    const contexts: WorkTipContext[] = [
      EMPTY,
      { ...EMPTY, inProgress: 1 },
      { ...EMPTY, planned: 1, hasMultiCaseRun: true },
      { ...EMPTY, planned: 1, jiraConfigured: true, hasUnlinkedRun: true },
      { ...EMPTY, planned: 1 }
    ];

    for (const context of contexts) {
      const tip = pickWorkTip(context);
      expect(tip).not.toBeNull();
      // A tip with no basis is advice, and `CLAUDE.md` forbids filling policy gaps from
      // general QA practice. The two UI tips say so in their basis line rather than
      // citing a rule they do not have.
      expect(tip?.basis).toBeTruthy();
      // Nothing here grades, targets or recommends — `business-rules-and-validation.md:39`
      // defines no threshold, so a tip must not imply one.
      expect(tip?.body).not.toMatch(/%|should|recommend|best practice/i);
    }
  });
});
