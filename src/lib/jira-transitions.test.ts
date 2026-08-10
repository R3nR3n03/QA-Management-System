import { describe, expect, it } from "vitest";
import { pickDoneTransition, type JiraTransition } from "./jira-transitions";

const t = (id: string, name: string, category: string): JiraTransition => ({
  id,
  name,
  to: { name, statusCategory: { key: category } }
});

const typical = [
  t("11", "To Do", "new"),
  t("21", "In Progress", "indeterminate"),
  t("31", "Done", "done")
];

describe("pickDoneTransition", () => {
  it("picks the transition whose target status is in the done category", () => {
    expect(pickDoneTransition(typical)).toBe("31");
  });

  // The reason this resolves by category and not by name: status names are user-editable
  // text and differ per project, while the three categories are a Jira primitive.
  it("works on a workflow that calls it something else", () => {
    expect(pickDoneTransition([t("11", "To Do", "new"), t("99", "Shipped", "done")])).toBe("99");
  });

  it("ignores a transition merely NAMED Done that lands somewhere else", () => {
    expect(
      pickDoneTransition([t("41", "Done-ish review", "indeterminate"), t("55", "Closed", "done")])
    ).toBe("55");
  });

  it("returns null when the workflow offers no done-category transition", () => {
    expect(pickDoneTransition([t("11", "To Do", "new")])).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(pickDoneTransition([])).toBeNull();
  });

  // The per-project override exists for a workflow with several done-category statuses,
  // where which one is chosen actually matters.
  it("prefers a configured override", () => {
    expect(pickDoneTransition([...typical, t("32", "Won't Do", "done")], "32")).toBe("32");
  });

  it("ignores an override the workflow does not offer, rather than sending an illegal id", () => {
    expect(pickDoneTransition(typical, "999")).toBe("31");
  });

  it("takes the first done-category transition when several qualify and none is configured", () => {
    expect(pickDoneTransition([t("31", "Done", "done"), t("32", "Won't Do", "done")])).toBe("31");
  });

  it("tolerates a malformed entry instead of throwing on someone else's payload", () => {
    const ragged = [{ id: "1" }, null, t("31", "Done", "done")] as unknown as JiraTransition[];
    expect(pickDoneTransition(ragged)).toBe("31");
  });
});
