import { describe, expect, it } from "vitest";
import { readOptionalText } from "./form-data";

function form(entries: Array<[string, string]>): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

describe("readOptionalText", () => {
  // The three states a domain service needs to tell apart. `undefined` and `null` mean
  // genuinely different things to `updateExecution`: leave the value alone, versus clear it.
  it("returns undefined when the field was not on the form at all", () => {
    expect(readOptionalText(form([["testerId", "u1"]]), "jiraIssueKey")).toBeUndefined();
  });

  it("returns null when the field was rendered but left empty", () => {
    expect(readOptionalText(form([["jiraIssueKey", ""]]), "jiraIssueKey")).toBeNull();
  });

  it("returns null when the field holds only whitespace", () => {
    expect(readOptionalText(form([["jiraIssueKey", "   "]]), "jiraIssueKey")).toBeNull();
  });

  it("returns the trimmed value when the field holds one", () => {
    expect(readOptionalText(form([["jiraIssueKey", "  PROJ-123 "]]), "jiraIssueKey")).toBe(
      "PROJ-123"
    );
  });

  it("does not validate — a malformed value is passed through for the domain to refuse", () => {
    expect(readOptionalText(form([["jiraIssueKey", "nope"]]), "jiraIssueKey")).toBe("nope");
  });

  it("reads the first value when a field somehow appears twice", () => {
    expect(
      readOptionalText(
        form([
          ["jiraIssueKey", "PROJ-1"],
          ["jiraIssueKey", "PROJ-2"]
        ]),
        "jiraIssueKey"
      )
    ).toBe("PROJ-1");
  });

  // A file input posts a File, not a string; treating it as text would stringify to
  // "[object File]" and reach the domain as a nonsense value.
  it("treats a non-text entry as absent", () => {
    const data = new FormData();
    data.append("jiraIssueKey", new Blob(["x"]), "x.txt");
    expect(readOptionalText(data, "jiraIssueKey")).toBeUndefined();
  });
});
