// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CasePicker } from "./case-picker";
import { RENDER_LIMIT, type PlanCandidate } from "./plan-grouping";

/**
 * `PlanForm.test.tsx` already covers the grouping, filtering and cap behaviour through the
 * form that used to own this markup, and `plan-grouping.test.ts` covers the rules
 * themselves against a table of cases. What is NEW here — and therefore what this file is
 * about — is the contract the extraction introduced: the selection is the caller's, and the
 * field it submits under is a prop.
 *
 * The assertions that matter are about what the caller receives and what the form body would
 * carry, never about what is visible: the filters, the collapsed groups and the render cap
 * all narrow the list, and none of them may narrow the selection.
 */

afterEach(cleanup);

const pad = (n: number) => String(n).padStart(4, "0");

function makeCases(count: number): PlanCandidate[] {
  return Array.from({ length: count }, (_, index) => {
    const n = index + 1;
    const odd = n % 2 === 1;
    return {
      id: `case-${n}`,
      businessId: `TC-PICK-${pad(n)}`,
      title: `Candidate ${n}`,
      priority: odd ? "High" : "Low",
      severity: odd ? "Major" : "Minor",
      productId: odd ? "product-a" : "product-b",
      featureId: odd ? "feature-1" : "feature-2",
      featureBusinessId: odd ? "FEAT001" : "FEAT002",
      requirementId: odd ? "req-1" : "req-2",
      requirementBusinessId: odd ? "REQ001" : "REQ002",
      moduleName: odd ? "Checkout" : "Search",
      featureName: odd ? "Card payment" : "Autocomplete"
    };
  });
}

/** A caller that owns the selection, which is the shape both real callers have. */
function Host({
  cases,
  name = "cases",
  initial = []
}: {
  cases: PlanCandidate[];
  name?: string;
  initial?: string[];
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(initial));
  return (
    <form data-testid="host">
      <CasePicker cases={cases} selected={selected} onSelectedChange={setSelected} name={name} />
      <output data-testid="count">{selected.size}</output>
    </form>
  );
}

/**
 * Every value the form would actually submit under `name`: a ticked checkbox or a hidden
 * input. An unticked box is markup, not a value — counting one would make this assert the
 * opposite of what it is for.
 */
const submitted = (name: string) =>
  [...screen.getByTestId("host").querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)]
    .filter((input) => input.type === "hidden" || input.checked)
    .map((input) => input.value)
    .sort();

const openFeature = (businessId: string) =>
  fireEvent.click(screen.getByRole("button", { expanded: false, name: new RegExp(businessId) }));

describe("CasePicker", () => {
  it("reports every change to the caller rather than keeping a selection of its own", () => {
    render(<Host cases={makeCases(4)} />);
    openFeature("FEAT001");

    fireEvent.click(screen.getByRole("checkbox", { name: /TC-PICK-0001/ }));
    expect(screen.getByTestId("count").textContent).toBe("1");

    fireEvent.click(screen.getByRole("checkbox", { name: /TC-PICK-0001/ }));
    expect(screen.getByTestId("count").textContent).toBe("0");
  });

  it("starts from the caller's selection", () => {
    render(<Host cases={makeCases(4)} initial={["case-1", "case-3"]} />);
    expect(screen.getByTestId("count").textContent).toBe("2");
    expect(submitted("cases")).toEqual(["case-1", "case-3"]);
  });

  it("submits under whatever field the caller names", () => {
    render(<Host cases={makeCases(4)} name="testCaseIds" initial={["case-1"]} />);
    expect(submitted("testCaseIds")).toEqual(["case-1"]);
    expect(submitted("cases")).toEqual([]);
  });

  it("takes a whole feature in one click, and only that feature", () => {
    render(<Host cases={makeCases(4)} />);
    // Two features, evens and odds; the group control states the number it will take.
    fireEvent.click(screen.getByRole("checkbox", { name: /Select all 2 in FEAT001/ }));
    expect(submitted("cases")).toEqual(["case-1", "case-3"]);
  });

  it("keeps a filtered-out selection in the body", () => {
    // More than five, or the needle does not earn its place and there is nothing to type in.
    render(<Host cases={makeCases(8)} />);
    openFeature("FEAT001");
    fireEvent.click(screen.getByRole("checkbox", { name: /TC-PICK-0001/ }));

    // Narrow to something that cannot match the selected case.
    fireEvent.change(screen.getByLabelText("Filter approved test cases"), { target: { value: "TC-PICK-0002" } });
    expect(screen.queryByRole("checkbox", { name: /TC-PICK-0001/ })).toBeNull();

    // Still submitted, and the count still says so.
    expect(submitted("cases")).toEqual(["case-1"]);
    expect(screen.getByTestId("count").textContent).toBe("1");
  });

  it("keeps a selection the render cap cut out of the list", () => {
    // One feature holding more than the cap, so the tail is selected and then unrendered.
    const many = makeCases(RENDER_LIMIT + 20).map((one) => ({
      ...one,
      featureId: "feature-1",
      featureBusinessId: "FEAT001",
      featureName: "Card payment",
      moduleName: "Checkout"
    }));
    render(<Host cases={many} initial={[`case-${RENDER_LIMIT + 15}`]} />);

    expect(screen.queryByRole("checkbox", { name: new RegExp(`TC-PICK-${pad(RENDER_LIMIT + 15)}`) })).toBeNull();
    expect(submitted("cases")).toEqual([`case-${RENDER_LIMIT + 15}`]);
    // And the reader is told, rather than left to read "1 selected" over no ticked row.
    expect(screen.getByText(/1 not shown/)).toBeTruthy();
  });

  it("clears through the caller too", () => {
    render(<Host cases={makeCases(4)} initial={["case-1", "case-3"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.getByTestId("count").textContent).toBe("0");
    expect(submitted("cases")).toEqual([]);
  });

  describe("automation indicator", () => {
    it("shows the latest outcome and how many checks the case has ever had", () => {
      const cases = makeCases(4);
      cases[0] = { ...cases[0]!, automation: { outcome: "FAILED", count: 14 } };
      render(<Host cases={cases} />);
      openFeature("FEAT001");

      expect(screen.getByText(/Failed/)).toBeTruthy();
      expect(screen.getByText(/last of 14/)).toBeTruthy();
    });

    it("is silent for a case with no automation, rather than a muted placeholder", () => {
      // Most cases will have none: a "no automation" label repeated on every row is noise
      // the row has no space for, so absence is the whole signal.
      render(<Host cases={makeCases(4)} />);
      openFeature("FEAT001");

      expect(screen.queryByText(/last of/)).toBeNull();
    });

    it("is not something the needle can filter by", () => {
      const cases = makeCases(8);
      cases[0] = { ...cases[0]!, automation: { outcome: "FAILED", count: 1 } };
      render(<Host cases={cases} />);

      // A needle naming the outcome word must not match a case through it.
      fireEvent.change(screen.getByLabelText("Filter approved test cases"), {
        target: { value: "Failed" }
      });
      expect(screen.queryByText(/TC-PICK-0001/)).toBeNull();
    });
  });
});
