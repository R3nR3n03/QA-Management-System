// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// The server action is the commit boundary and is exercised by the acceptance suite;
// these tests are about which case ids the form puts in the body before it is called.
vi.mock("./actions", () => ({ createExecutionAction: vi.fn(async () => null) }));

import { PlanForm } from "./PlanForm";

/**
 * The planner picks the cases a run will cover. Three things narrow what is on screen — the
 * filters, the collapsed feature groups, and the cap on how many rows are rendered at once —
 * and NONE of them may narrow what is submitted. A silently dropped case means a run that
 * covers less than the person planning it believed, which they would only discover at finalize.
 *
 * So the assertions that matter here are about the submitted body rather than the visible list.
 *
 * The grouping, filtering, open/closed and cap rules themselves live in
 * `src/ui/plan-grouping.ts` and are tested there against a table of cases. This file is about
 * what the rendered form does with them.
 */

afterEach(cleanup);

const pad = (n: number) => String(n).padStart(4, "0");

/**
 * Odd cases sit in product-a/FEAT001 (Checkout · Card payment) at High priority, even ones in
 * product-b/FEAT002 (Search · Autocomplete) at Low — so the product filter, the feature
 * grouping and the needle each have something to separate that is neither the ID nor the
 * title. Requirements split further within each product — product-a's odds into req-1/req-2,
 * product-b's evens into req-3/req-4 — so a requirement filter narrows what a product filter
 * alone would not.
 */
function makeCases(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const n = index + 1;
    const odd = n % 2 === 1;
    const requirementNumber = odd ? (n % 4 === 1 ? 1 : 2) : n % 4 === 2 ? 3 : 4;
    return {
      id: `case-${n}`,
      businessId: `TC-PLAN-${pad(n)}`,
      title: `Candidate ${n}`,
      priority: odd ? "High" : "Low",
      severity: odd ? "Major" : "Minor",
      productId: odd ? "product-a" : "product-b",
      featureId: odd ? "feature-1" : "feature-2",
      featureBusinessId: odd ? "FEAT001" : "FEAT002",
      requirementId: `req-${requirementNumber}`,
      requirementBusinessId: `REQ00${requirementNumber}`,
      moduleName: odd ? "Checkout" : "Search",
      featureName: odd ? "Card payment" : "Autocomplete"
    };
  });
}

/**
 * One feature holding everything, so the render cap can bite INSIDE a group.
 *
 * `makeCases` spreads its cases over two features, and with the cap at 100 neither half of a
 * 140-case corpus reaches it on its own — the cap is only observable once a single group has
 * more matching cases than the whole list may render.
 */
function oneFeatureCases(count: number) {
  return makeCases(count).map((one) => ({
    ...one,
    productId: "product-a",
    featureId: "feature-1",
    featureBusinessId: "FEAT001",
    moduleName: "Checkout",
    featureName: "Card payment"
  }));
}

const PRODUCTS = [
  { id: "product-a", businessId: "PROD001", name: "Storefront" },
  { id: "product-b", businessId: "PROD002", name: "Back office" }
];

const TESTERS = [
  { id: "user-1", displayName: "Ada Tester", openRuns: 0 },
  { id: "user-2", displayName: "Grace Tester", openRuns: 4 }
];

/** Every case id the form would post: ticked checkboxes plus the hidden carriers. */
function submittedIds(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll<HTMLInputElement>('input[name="testCaseIds"]')
  )
    .filter((input) => input.type === "hidden" || input.checked)
    .map((input) => input.value)
    .sort();
}

/**
 * The case checkboxes only. A group header carries a checkbox of its own — the one that takes
 * the whole feature — so counting every checkbox on screen would count controls, not
 * candidates.
 */
function caseBoxes(container: HTMLElement): HTMLInputElement[] {
  return Array.from(
    container.querySelectorAll<HTMLInputElement>('input[name="testCaseIds"]:not([type="hidden"])')
  );
}

const filterBox = () => screen.getByLabelText("Filter approved test cases");
const productBox = () => screen.getByLabelText("Filter by product") as HTMLSelectElement;
const requirementBox = () => screen.getByLabelText("Filter by requirement") as HTMLSelectElement;

/** The disclosure for one feature, found by the business ID in its accessible name. */
const groupToggle = (featureBusinessId: string) =>
  screen.getByRole("button", { name: new RegExp(featureBusinessId) });

const openGroup = (featureBusinessId: string) => fireEvent.click(groupToggle(featureBusinessId));

describe("PlanForm", () => {
  it("asks for a purpose, required and capped, before anything else", () => {
    // The headline every row of `/executions` and `/my-work` is listed under, so it is not
    // optional and not at the bottom. `maxLength` stops the typing at the documented cap
    // rather than letting a paragraph be written and lost on submit.
    render(<PlanForm cases={makeCases(3)} testers={TESTERS} />);

    const purpose = screen.getByRole("textbox", { name: /Purpose/ }) as HTMLInputElement;
    expect(purpose.required).toBe(true);
    expect(purpose.maxLength).toBe(120);
    expect(purpose.value).toBe("");
  });

  it("prefills the purpose of the run a rerun came from", () => {
    // A rerun of the Sprint 24 regression is still the Sprint 24 regression. A preselection
    // like the ticked cases, never an instruction — it is a plain default the planner edits.
    render(
      <PlanForm
        cases={makeCases(3)}
        testers={TESTERS}
        preselect={["case-1"]}
        defaultPurpose="Sprint 24 regression, Chrome"
      />
    );

    expect((screen.getByRole("textbox", { name: /Purpose/ }) as HTMLInputElement).value).toBe(
      "Sprint 24 regression, Chrome"
    );
  });

  it("starts with the preselected cases ticked", () => {
    const { container } = render(
      <PlanForm cases={makeCases(6)} testers={TESTERS} preselect={["case-2", "case-5"]} />
    );

    expect(screen.getByText(/2 cases selected/)).toBeTruthy();
    expect(submittedIds(container)).toEqual(["case-2", "case-5"]);
  });

  it("reports cases a rerun could not carry over", () => {
    render(<PlanForm cases={makeCases(3)} testers={TESTERS} preselect={["case-1"]} unavailable={2} />);

    expect(screen.getByText("2 cases could not be carried over")).toBeTruthy();
    expect(screen.getByText(/no longer Approved/)).toBeTruthy();
  });

  /**
   * The filter sits INSIDE this form, so Enter would otherwise trigger the browser's implicit
   * submission and fire the real submit button — committing the run and redirecting away from a
   * keystroke meant to narrow a list. It only bites once something is selected, because that is
   * when the submit button stops being disabled, which is exactly the moment someone filters
   * again to look for the next case.
   */
  it("does not submit the run when Enter is pressed in the case filter", () => {
    const { container } = render(<PlanForm cases={makeCases(6)} testers={TESTERS} />);

    openGroup("FEAT001");
    fireEvent.click(caseBoxes(container)[0]);

    // The submit is live now — the state in which implicit submission would fire.
    expect((screen.getByRole("button", { name: /^Plan execution/ }) as HTMLButtonElement).disabled).toBe(
      false
    );

    const enter = fireEvent.keyDown(filterBox(), { key: "Enter", code: "Enter" });

    // `fireEvent` returns false when a handler called preventDefault(), which is what stops the
    // browser from submitting the form around the input.
    expect(enter).toBe(false);
  });

  it("shows each tester's open workload alongside their name", () => {
    render(<PlanForm cases={makeCases(3)} testers={TESTERS} />);

    expect(screen.getByRole("option", { name: "Ada Tester · 0 open" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Grace Tester · 4 open" })).toBeTruthy();
  });

  it("will not submit an empty run, and restates what it will cover", () => {
    const { container } = render(<PlanForm cases={makeCases(6)} testers={TESTERS} />);

    const submit = () => screen.getByRole("button", { name: /^Plan execution/ }) as HTMLButtonElement;
    expect(submit().disabled).toBe(true);
    expect(screen.getByText("Pick at least one approved case to cover.")).toBeTruthy();

    openGroup("FEAT001");
    fireEvent.click(caseBoxes(container)[0]);
    fireEvent.click(caseBoxes(container)[1]);

    expect(submit().disabled).toBe(false);
    expect(screen.getByRole("button", { name: "Plan execution covering 2 cases" })).toBeTruthy();
  });
});

describe("PlanForm feature groups", () => {
  // The point of the grouping: the shape of the corpus is legible before any case row is.
  it("lists one collapsed group per feature, with no case rows at all", () => {
    const { container } = render(<PlanForm cases={makeCases(6)} testers={TESTERS} />);

    expect(groupToggle("FEAT001").getAttribute("aria-expanded")).toBe("false");
    expect(groupToggle("FEAT002").getAttribute("aria-expanded")).toBe("false");
    expect(caseBoxes(container)).toHaveLength(0);
  });

  it("heads each group with its feature, its module and how much of it is selected", () => {
    render(<PlanForm cases={makeCases(6)} testers={TESTERS} preselect={["case-1"]} />);

    const header = groupToggle("FEAT001");
    expect(header.textContent).toContain("Card payment");
    expect(header.textContent).toContain("Checkout");
    expect(header.textContent).toContain("1 of 3 selected");
  });

  it("reveals a feature's cases when its header is opened, and puts them away again", () => {
    const { container } = render(<PlanForm cases={makeCases(6)} testers={TESTERS} />);

    openGroup("FEAT001");
    expect(caseBoxes(container).map((box) => box.value)).toEqual(["case-1", "case-3", "case-5"]);

    openGroup("FEAT001");
    expect(caseBoxes(container)).toHaveLength(0);
  });

  // A rerun's preselection must not start hidden: a selection you cannot see is one you
  // cannot check before committing to it.
  it("opens a group that already holds a selected case", () => {
    render(<PlanForm cases={makeCases(6)} testers={TESTERS} preselect={["case-4"]} />);

    expect(groupToggle("FEAT002").getAttribute("aria-expanded")).toBe("true");
    expect(groupToggle("FEAT001").getAttribute("aria-expanded")).toBe("false");
  });

  it("takes a whole feature in one click, and says how many that is", () => {
    const { container } = render(<PlanForm cases={makeCases(6)} testers={TESTERS} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all 3 in FEAT001" }));

    expect(submittedIds(container)).toEqual(["case-1", "case-3", "case-5"]);
    // Selecting the feature opens it, because it now holds a selection.
    expect(groupToggle("FEAT001").getAttribute("aria-expanded")).toBe("true");
  });

  it("clears a fully selected feature rather than reselecting it", () => {
    const { container } = render(
      <PlanForm cases={makeCases(6)} testers={TESTERS} preselect={["case-1", "case-3", "case-5"]} />
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Clear the 3 in FEAT001" }));

    expect(submittedIds(container)).toEqual([]);
  });

  /**
   * The failure the old global "Select all N shown" had: past the render cap its label
   * promised more than it took. A group's label always states the number the click will
   * actually take, and under a filter it says so in as many words.
   */
  it("counts only what the filter left, and says the word matching", () => {
    const { container } = render(<PlanForm cases={makeCases(6)} testers={TESTERS} />);

    fireEvent.change(filterBox(), { target: { value: "Candidate 3" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all 1 matching in FEAT001" }));

    expect(submittedIds(container)).toEqual(["case-3"]);
  });

  it("leaves a part-selected feature's box neither ticked nor empty", () => {
    render(<PlanForm cases={makeCases(6)} testers={TESTERS} preselect={["case-1"]} />);

    const box = screen.getByRole("checkbox", { name: /FEAT001/ }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(box.indeterminate).toBe(true);
  });

  it("ticks a fully selected feature's box outright", () => {
    render(
      <PlanForm cases={makeCases(6)} testers={TESTERS} preselect={["case-1", "case-3", "case-5"]} />
    );

    const box = screen.getByRole("checkbox", { name: /FEAT001/ }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.indeterminate).toBe(false);
  });

  it("drops a group the filter emptied instead of showing it at zero", () => {
    render(<PlanForm cases={makeCases(6)} testers={TESTERS} />);

    fireEvent.change(filterBox(), { target: { value: "Autocomplete" } });

    expect(screen.getByRole("button", { name: /FEAT002/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /FEAT001/ })).toBeNull();
  });
});

describe("PlanForm group disclosure and the needle", () => {
  // A search that appears to find nothing until you start clicking headers would be worse
  // than no search at all.
  it("opens every group the needle matched, and closes them when it is cleared", () => {
    const { container } = render(<PlanForm cases={makeCases(6)} testers={TESTERS} />);

    fireEvent.change(filterBox(), { target: { value: "Candidate" } });
    expect(groupToggle("FEAT001").getAttribute("aria-expanded")).toBe("true");
    expect(caseBoxes(container)).toHaveLength(6);

    fireEvent.change(filterBox(), { target: { value: "" } });
    expect(groupToggle("FEAT001").getAttribute("aria-expanded")).toBe("false");
    expect(caseBoxes(container)).toHaveLength(0);
  });

  // The needle adds openings; it never closes what the reader chose to look at.
  it("leaves a hand-opened group open after the needle is cleared", () => {
    render(<PlanForm cases={makeCases(6)} testers={TESTERS} />);

    openGroup("FEAT001");
    fireEvent.change(filterBox(), { target: { value: "Candidate" } });
    fireEvent.change(filterBox(), { target: { value: "" } });

    expect(groupToggle("FEAT001").getAttribute("aria-expanded")).toBe("true");
    expect(groupToggle("FEAT002").getAttribute("aria-expanded")).toBe("false");
  });

  it("collapses everything on request, including groups holding a selection", () => {
    const { container } = render(<PlanForm cases={makeCases(6)} testers={TESTERS} preselect={["case-1"]} />);

    expect(groupToggle("FEAT001").getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));

    expect(groupToggle("FEAT001").getAttribute("aria-expanded")).toBe("false");
    expect(caseBoxes(container)).toHaveLength(0);
    // Collapsing hides the tick; it must never drop it.
    expect(submittedIds(container)).toEqual(["case-1"]);
  });

  it("offers no way back once everything is closed", () => {
    render(<PlanForm cases={makeCases(6)} testers={TESTERS} />);

    expect(screen.queryByRole("button", { name: "Collapse all" })).toBeNull();
  });

  /**
   * Collapse-all has to record an explicit close on every group — that is the only way to shut
   * one holding a selection — and an explicit close outranks the needle. Left standing, the
   * next search would match cases inside groups that stay shut, and with no expand-all the
   * reader would be left clicking eleven headers to recover.
   */
  it("still lets the needle open a group after everything was collapsed", () => {
    const { container } = render(<PlanForm cases={makeCases(6)} testers={TESTERS} preselect={["case-1"]} />);

    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(caseBoxes(container)).toHaveLength(0);

    fireEvent.change(filterBox(), { target: { value: "Candidate 4" } });

    expect(groupToggle("FEAT002").getAttribute("aria-expanded")).toBe("true");
    expect(caseBoxes(container).map((box) => box.value)).toEqual(["case-4"]);
  });

  /**
   * Deliberately absent. Opening everything rebuilds the flat list the grouping exists to
   * replace, and hands the reader a capped one at that — the needle and "Only selected" are
   * both better answers.
   */
  it("has no expand-all control", () => {
    render(<PlanForm cases={makeCases(6)} testers={TESTERS} />);

    expect(screen.queryByRole("button", { name: /Expand all|Open all/ })).toBeNull();
  });
});

describe("PlanForm keeps what is out of sight", () => {
  it("keeps a selection that the needle has hidden", () => {
    const { container } = render(<PlanForm cases={makeCases(6)} testers={TESTERS} />);

    openGroup("FEAT001");
    fireEvent.click(caseBoxes(container)[0]);
    // Narrow to a case that is not the selected one — the tick leaves the screen.
    fireEvent.change(filterBox(), { target: { value: "Candidate 4" } });

    expect(caseBoxes(container).map((box) => box.value)).toEqual(["case-4"]);
    expect(screen.getByText(/1 case selected \(1 not shown\)/)).toBeTruthy();
    expect(submittedIds(container)).toEqual(["case-1"]);
  });

  it("keeps a selection a collapsed group is hiding", () => {
    const { container } = render(<PlanForm cases={makeCases(6)} testers={TESTERS} preselect={["case-1"]} />);

    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));

    expect(screen.getByText(/1 case selected \(1 not shown\)/)).toBeTruthy();
    expect(submittedIds(container)).toEqual(["case-1"]);
  });

  it("keeps a selection the product filter has scoped out of view", () => {
    const { container } = render(
      <PlanForm cases={makeCases(6)} testers={TESTERS} products={PRODUCTS} />
    );

    openGroup("FEAT002");
    fireEvent.click(caseBoxes(container)[0]);
    fireEvent.change(productBox(), { target: { value: "product-a" } });

    // Case 2 belongs to the other product, so it leaves the screen — but not the run.
    expect(screen.queryByRole("button", { name: /FEAT002/ })).toBeNull();
    expect(screen.getByText(/1 case selected \(1 not shown\)/)).toBeTruthy();
    expect(submittedIds(container)).toEqual(["case-2"]);
  });

  it("keeps a selection the requirement filter has scoped out of view", () => {
    const { container } = render(<PlanForm cases={makeCases(6)} testers={TESTERS} />);

    openGroup("FEAT001");
    // Case 3 is req-2.
    fireEvent.click(caseBoxes(container)[1]);
    fireEvent.change(requirementBox(), { target: { value: "req-1" } });

    expect(caseBoxes(container).map((box) => box.value)).toEqual(["case-1", "case-5"]);
    expect(screen.getByText(/1 case selected \(1 not shown\)/)).toBeTruthy();
    expect(submittedIds(container)).toEqual(["case-3"]);
  });

  it("clears the whole selection, on screen or not", () => {
    const { container } = render(
      <PlanForm cases={makeCases(6)} testers={TESTERS} preselect={["case-1", "case-4"]} />
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));

    expect(submittedIds(container)).toEqual([]);
  });
});

/*
 * The long timeout is about the QUERY, not the component. A `*ByRole` with a `name` computes
 * an accessible name for every candidate, and at the render cap that is 100 checkboxes walked
 * by dom-accessibility-api — comfortably under the 5s default on its own, but not when vitest
 * is running this file beside dozens of others on the same cores. That made these tests fail
 * only in a full `npm run test`, which is the worst kind of red: it reads as a regression in
 * the picker and is not one.
 */
const CAPPED_LIST_TIMEOUT_MS = 30_000;

describe("PlanForm render cap", () => {
  it(
    "renders no more rows than the cap and says what a truncated group is holding back",
    () => {
      const { container } = render(<PlanForm cases={oneFeatureCases(140)} testers={TESTERS} />);

      openGroup("FEAT001");

      expect(caseBoxes(container)).toHaveLength(100);
      expect(
        screen.getByText("Showing 100 of 140 in FEAT001 — the list is capped at 100 rows.")
      ).toBeTruthy();
      expect(
        screen.getByText(/100 of the 140 cases in the open features are on screen/)
      ).toBeTruthy();
    },
    CAPPED_LIST_TIMEOUT_MS
  );

  /**
   * The notice counts the OPEN features, not the corpus. Blaming the cap for cases that are
   * merely collapsed would send a reader to narrow a filter that was never the reason they are
   * missing — here, 30 of the 170 cases are absent because FEAT002 is shut.
   */
  it(
    "does not blame the cap for cases a closed feature is holding",
    () => {
      const spread = [...oneFeatureCases(140), ...makeCases(60).slice(30).map((one) => ({
        ...one,
        featureId: "feature-9",
        featureBusinessId: "FEAT009",
        moduleName: "Search",
        featureName: "Autocomplete"
      }))];

      render(<PlanForm cases={spread} testers={TESTERS} />);
      openGroup("FEAT001");

      expect(screen.getByText(/100 of the 140 cases in the open features are on screen/)).toBeTruthy();
    },
    CAPPED_LIST_TIMEOUT_MS
  );

  // The cap is on rendering, not on reach: the needle still finds a withheld case.
  it(
    "still finds a case the cap withheld",
    () => {
      const { container } = render(<PlanForm cases={oneFeatureCases(140)} testers={TESTERS} />);

      fireEvent.change(filterBox(), { target: { value: "TC-PLAN-0137" } });

      expect(caseBoxes(container).map((box) => box.value)).toEqual(["case-137"]);
    },
    CAPPED_LIST_TIMEOUT_MS
  );

  it(
    "submits a preselected case that falls past the render cap",
    () => {
      const { container } = render(
        <PlanForm cases={oneFeatureCases(140)} testers={TESTERS} preselect={["case-137"]} />
      );

      expect(caseBoxes(container).some((box) => box.value === "case-137")).toBe(false);
      expect(submittedIds(container)).toEqual(["case-137"]);
    },
    CAPPED_LIST_TIMEOUT_MS
  );

  it(
    "brings an off-screen selection back into view",
    () => {
      const { container } = render(
        <PlanForm cases={oneFeatureCases(140)} testers={TESTERS} preselect={["case-137"]} />
      );

      // Past the render cap, so invisible — the count is the only trace of it.
      expect(screen.getByText(/1 case selected \(1 not shown\)/)).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Only selected" }));

      expect(caseBoxes(container).map((box) => box.value)).toEqual(["case-137"]);
      expect(screen.queryByText(/not shown/)).toBeNull();
    },
    CAPPED_LIST_TIMEOUT_MS
  );

  // A group nobody opened costs the cap nothing, which is what makes it almost unreachable
  // now: a reader would have to open most of the corpus to meet it.
  it("says nothing about the cap while the groups are closed", () => {
    render(<PlanForm cases={oneFeatureCases(140)} testers={TESTERS} />);

    expect(screen.queryByText(/matching cases are on screen/)).toBeNull();
    expect(screen.queryByText(/capped at/)).toBeNull();
  });
});

describe("PlanForm filters", () => {
  it("scopes the candidates to one product, and composes with the needle", () => {
    const { container } = render(<PlanForm cases={makeCases(6)} testers={TESTERS} products={PRODUCTS} />);

    fireEvent.change(productBox(), { target: { value: "product-a" } });
    expect(screen.queryByRole("button", { name: /FEAT002/ })).toBeNull();

    // The needle searches inside the product, not across the catalogue.
    fireEvent.change(filterBox(), { target: { value: "Candidate 3" } });
    expect(caseBoxes(container).map((box) => box.value)).toEqual(["case-3"]);
  });

  it("matches a field a row displays but no dropdown covers", () => {
    const { container } = render(<PlanForm cases={makeCases(6)} testers={TESTERS} />);

    // Neither needle appears in a business ID or a title, and both are visible, so both
    // must be matchable.
    fireEvent.change(filterBox(), { target: { value: "Checkout" } });
    expect(caseBoxes(container)).toHaveLength(3);

    fireEvent.change(filterBox(), { target: { value: "Minor" } });
    expect(caseBoxes(container).map((box) => box.value)).toEqual(["case-2", "case-4", "case-6"]);
  });

  it("offers a requirement filter with no products prop at all", () => {
    const { container } = render(<PlanForm cases={makeCases(6)} testers={TESTERS} />);

    expect(screen.getByRole("option", { name: "REQ001" })).toBeTruthy();
    fireEvent.change(requirementBox(), { target: { value: "req-1" } });

    // req-1 is cases 1 and 5, and a requirement filter opens no group by itself.
    openGroup("FEAT001");
    expect(caseBoxes(container).map((box) => box.value)).toEqual(["case-1", "case-5"]);
  });

  it("composes the requirement filter with the needle", () => {
    const { container } = render(<PlanForm cases={makeCases(6)} testers={TESTERS} />);

    fireEvent.change(requirementBox(), { target: { value: "req-1" } });
    fireEvent.change(filterBox(), { target: { value: "Candidate 5" } });

    expect(caseBoxes(container).map((box) => box.value)).toEqual(["case-5"]);
  });

  it("matches a requirement business ID by the needle alone", () => {
    const { container } = render(<PlanForm cases={makeCases(6)} testers={TESTERS} />);

    fireEvent.change(filterBox(), { target: { value: "REQ002" } });

    expect(caseBoxes(container).map((box) => box.value)).toEqual(["case-3"]);
  });

  /**
   * A product is the broader cut, so selecting one rescopes which requirements are even worth
   * offering — REQ003/REQ004 belong to product-b and would only ever produce an empty list
   * once product-a is chosen. The same reasoning `page.tsx` applies to products.
   */
  it("scopes the requirement options to the selected product", () => {
    render(<PlanForm cases={makeCases(6)} testers={TESTERS} products={PRODUCTS} />);

    expect(screen.getByRole("option", { name: "REQ003" })).toBeTruthy();

    fireEvent.change(productBox(), { target: { value: "product-a" } });
    expect(screen.getByRole("option", { name: "REQ001" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "REQ002" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "REQ003" })).toBeNull();
    expect(screen.queryByRole("option", { name: "REQ004" })).toBeNull();
  });

  it("resets the requirement filter when the product changes underneath it", () => {
    render(<PlanForm cases={makeCases(6)} testers={TESTERS} products={PRODUCTS} />);

    fireEvent.change(requirementBox(), { target: { value: "req-3" } });
    // req-3 belongs to product-b; switching to product-a would otherwise combine two filters
    // into a silent empty list with no explanation for either one.
    fireEvent.change(productBox(), { target: { value: "product-a" } });

    expect(requirementBox().value).toBe("");
    expect(screen.getByRole("button", { name: /FEAT001/ })).toBeTruthy();
  });

  /**
   * A single product still gets a dropdown. It cannot narrow anything today, but the
   * catalogue grows one product at a time and a filter that materialises by itself once
   * someone adds a second is a filter nobody knows to look for.
   */
  it("offers the product filter even when there is a single product", () => {
    render(<PlanForm cases={makeCases(6)} testers={TESTERS} products={[PRODUCTS[0]]} />);

    expect(screen.getByLabelText("Filter by product")).toBeTruthy();
    expect(screen.getByRole("option", { name: "PROD001 · Storefront" })).toBeTruthy();
  });

  it("offers no product filter when the screen passes no products", () => {
    render(<PlanForm cases={makeCases(6)} testers={TESTERS} />);

    expect(screen.queryByLabelText("Filter by product")).toBeNull();
  });

  /**
   * The needle is gated on the candidate list being long enough to be worth narrowing; the
   * product dropdown is not gated on that at all. Three approved cases spanning two products
   * is exactly the case a shared gate gets wrong — it hides the one control that could
   * separate them.
   */
  it("offers the product filter on a short candidate list, without the needle", () => {
    render(<PlanForm cases={makeCases(3)} testers={TESTERS} products={PRODUCTS} />);

    expect(screen.queryByLabelText("Filter approved test cases")).toBeNull();
    expect(screen.getByLabelText("Filter by product")).toBeTruthy();

    fireEvent.change(productBox(), { target: { value: "product-b" } });
    expect(screen.getByRole("button", { name: /FEAT002/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /FEAT001/ })).toBeNull();
  });

  /** There is no feature dropdown: the groups are the features. */
  it("offers no feature filter", () => {
    render(<PlanForm cases={makeCases(6)} testers={TESTERS} products={PRODUCTS} />);

    expect(screen.queryByLabelText("Filter by feature")).toBeNull();
  });
});

describe("PlanForm empty states", () => {
  it("says which nothing it is showing when the review list comes up empty", () => {
    render(<PlanForm cases={makeCases(6)} testers={TESTERS} preselect={["case-1"]} />);

    fireEvent.click(screen.getByRole("button", { name: "Only selected" }));
    fireEvent.change(filterBox(), { target: { value: "Autocomplete" } });

    // Not "nothing matches" — the case exists, the review scope just excludes it.
    expect(screen.getByText("The selected case is not in this scope.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show all approved cases" }));
    expect(screen.getByRole("button", { name: /FEAT001/ })).toBeTruthy();
  });

  // Reachable by clearing the selection while reviewing it: "Only selected" stays on, and
  // the reason the list is empty is now the empty selection rather than any filter.
  it("says nothing is selected yet when the selection is cleared mid-review", () => {
    render(<PlanForm cases={makeCases(6)} testers={TESTERS} preselect={["case-1"]} />);

    fireEvent.click(screen.getByRole("button", { name: "Only selected" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));

    expect(screen.getByText("Nothing is selected yet.")).toBeTruthy();
  });

  it("says what the needle failed to match when nothing else is narrowing", () => {
    render(<PlanForm cases={makeCases(6)} testers={TESTERS} />);

    fireEvent.change(filterBox(), { target: { value: "nothing here at all" } });

    expect(screen.getByText("Nothing matches “nothing here at all”.")).toBeTruthy();
  });

  it("names the product when its scope is what emptied the list", () => {
    render(<PlanForm cases={makeCases(6)} testers={TESTERS} products={PRODUCTS} />);

    fireEvent.change(productBox(), { target: { value: "product-a" } });
    fireEvent.change(filterBox(), { target: { value: "Autocomplete" } });

    expect(screen.getByText("Nothing matches “Autocomplete” in Storefront.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show all approved cases" }));
    expect(productBox().value).toBe("");
    expect(screen.getByRole("button", { name: /FEAT001/ })).toBeTruthy();
  });

  it("names the requirement when its scope is what emptied the list", () => {
    render(<PlanForm cases={makeCases(6)} testers={TESTERS} />);

    fireEvent.change(requirementBox(), { target: { value: "req-1" } });
    fireEvent.change(filterBox(), { target: { value: "Autocomplete" } });

    expect(screen.getByText("Nothing matches “Autocomplete” in REQ001.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show all approved cases" }));
    expect(requirementBox().value).toBe("");
  });

  it("names both scopes together when a product and a requirement combine to empty the list", () => {
    render(<PlanForm cases={makeCases(6)} testers={TESTERS} products={PRODUCTS} />);

    fireEvent.change(productBox(), { target: { value: "product-a" } });
    fireEvent.change(requirementBox(), { target: { value: "req-1" } });
    fireEvent.change(filterBox(), { target: { value: "Autocomplete" } });

    expect(screen.getByText("Nothing matches “Autocomplete” in Storefront · REQ001.")).toBeTruthy();
  });
});
