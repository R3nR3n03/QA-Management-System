// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// The server action is the commit boundary and is exercised by the acceptance suite;
// these tests are about which case ids the form puts in the body before it is called.
vi.mock("./actions", () => ({ createExecutionAction: vi.fn(async () => null) }));

import { PlanForm } from "./PlanForm";

/**
 * The planner picks the cases a run will cover. Two things narrow what is on screen —
 * the filter, and the cap on how many rows are rendered at once — and NEITHER may
 * narrow what is submitted. A silently dropped case means a run that covers less than
 * the person planning it believed, which they would only discover at finalize.
 *
 * So every assertion here is about the submitted body rather than the visible list.
 */

afterEach(cleanup);

const pad = (n: number) => String(n).padStart(4, "0");

/** Odd cases sit in product-a/Checkout/High, even ones in product-b/Search/Low, so the
    filters have something to separate that is neither the ID nor the title. */
function makeCases(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const n = index + 1;
    const odd = n % 2 === 1;
    return {
      id: `case-${n}`,
      businessId: `TC-PLAN-${pad(n)}`,
      title: `Candidate ${n}`,
      priority: odd ? "High" : "Low",
      severity: odd ? "Major" : "Minor",
      productId: odd ? "product-a" : "product-b",
      moduleName: odd ? "Checkout" : "Search",
      featureName: odd ? "Card payment" : "Autocomplete"
    };
  });
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

const filterBox = () => screen.getByLabelText("Filter approved test cases");
const productBox = () => screen.getByLabelText("Filter by product") as HTMLSelectElement;

describe("PlanForm", () => {
  it("starts with the preselected cases ticked", () => {
    const { container } = render(
      <PlanForm cases={makeCases(6)} testers={TESTERS} preselect={["case-2", "case-5"]} />
    );

    expect(screen.getByText(/2 cases selected/)).toBeTruthy();
    expect(submittedIds(container)).toEqual(["case-2", "case-5"]);
  });

  it("keeps a selection that the filter has hidden", () => {
    const { container } = render(<PlanForm cases={makeCases(6)} testers={TESTERS} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /TC-PLAN-0002/ }));
    // Narrow to a case that is not the selected one — the tick leaves the screen.
    fireEvent.change(filterBox(), { target: { value: "Candidate 4" } });

    expect(screen.queryByRole("checkbox", { name: /TC-PLAN-0002/ })).toBeNull();
    expect(screen.getByText(/1 case selected \(1 not shown\)/)).toBeTruthy();
    expect(submittedIds(container)).toEqual(["case-2"]);
  });

  it("renders a bounded number of rows and says what it withheld", () => {
    render(<PlanForm cases={makeCases(140)} testers={TESTERS} />);

    expect(screen.getAllByRole("checkbox")).toHaveLength(100);
    expect(
      screen.getByText(
        "Showing the first 100 of 140 approved cases — narrow the filter to reach the rest. Anything already selected still submits."
      )
    ).toBeTruthy();
    // The cap is on rendering, not on reach: the filter still finds a withheld case.
    fireEvent.change(filterBox(), { target: { value: "TC-PLAN-0137" } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  });

  /*
   * The long timeout is about the QUERY, not the component. A `*ByRole` with a `name`
   * computes an accessible name for every candidate, and at the render cap that is 100
   * checkboxes walked by dom-accessibility-api — comfortably under the 5s default on its
   * own, but not when vitest is running this file beside 38 others on the same cores.
   * That made this test and the one below fail only in a full `npm run test`, which is
   * the worst kind of red: it reads as a regression in the picker and is not one.
   */
  const CAPPED_LIST_TIMEOUT_MS = 30_000;

  it(
    "submits a preselected case that falls past the render cap",
    () => {
      const { container } = render(
        <PlanForm cases={makeCases(140)} testers={TESTERS} preselect={["case-137"]} />
      );

      expect(screen.queryByRole("checkbox", { name: /TC-PLAN-0137/ })).toBeNull();
      expect(submittedIds(container)).toEqual(["case-137"]);
    },
    CAPPED_LIST_TIMEOUT_MS
  );

  it("selects and clears only what is on screen, leaving the rest alone", () => {
    const { container } = render(<PlanForm cases={makeCases(6)} testers={TESTERS} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /TC-PLAN-0001/ }));
    fireEvent.change(filterBox(), { target: { value: "Candidate 4" } });
    fireEvent.click(screen.getByRole("button", { name: "Select all 1 shown" }));

    expect(submittedIds(container)).toEqual(["case-1", "case-4"]);

    fireEvent.click(screen.getByRole("button", { name: "Clear the 1 shown" }));
    // Case 1 was never on screen for that clear, so it survives it.
    expect(submittedIds(container)).toEqual(["case-1"]);

    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(submittedIds(container)).toEqual([]);
  });

  it("reports cases a rerun could not carry over", () => {
    render(<PlanForm cases={makeCases(3)} testers={TESTERS} preselect={["case-1"]} unavailable={2} />);

    expect(screen.getByText("2 cases could not be carried over")).toBeTruthy();
    expect(screen.getByText(/no longer Approved/)).toBeTruthy();
  });

  it("filters on the area and grading a run is actually scoped by", () => {
    render(<PlanForm cases={makeCases(6)} testers={TESTERS} />);

    // Neither needle appears in a business ID or a title, which is all the picker used
    // to offer — and both are visible on the row, so both must be matchable.
    fireEvent.change(filterBox(), { target: { value: "Checkout" } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);

    fireEvent.change(filterBox(), { target: { value: "Minor" } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(screen.getByRole("checkbox", { name: /TC-PLAN-0002/ })).toBeTruthy();
  });

  it(
    "brings an off-screen selection back into view",
    () => {
      render(<PlanForm cases={makeCases(140)} testers={TESTERS} preselect={["case-137"]} />);

      // Past the render cap, so invisible — the count is the only trace of it.
      expect(screen.queryByRole("checkbox", { name: /TC-PLAN-0137/ })).toBeNull();
      expect(screen.getByText(/1 case selected \(1 not shown\)/)).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Only selected" }));

      expect(screen.getByRole("checkbox", { name: /TC-PLAN-0137/ })).toBeTruthy();
      expect(screen.getAllByRole("checkbox")).toHaveLength(1);
      expect(screen.queryByText(/not shown/)).toBeNull();
    },
    CAPPED_LIST_TIMEOUT_MS
  );

  it("says which nothing it is showing when the review list comes up empty", () => {
    render(<PlanForm cases={makeCases(6)} testers={TESTERS} preselect={["case-1"]} />);

    fireEvent.click(screen.getByRole("button", { name: "Only selected" }));
    fireEvent.change(filterBox(), { target: { value: "Autocomplete" } });

    // Not "nothing matches" — the case exists, the review scope just excludes it. The
    // wording stays scope-general because either filter can be what excluded it.
    expect(screen.getByText("The selected case is not in this scope.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show all approved cases" }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(6);
  });

  it("will not submit an empty run, and restates what it will cover", () => {
    render(<PlanForm cases={makeCases(6)} testers={TESTERS} />);

    const submit = () => screen.getByRole("button", { name: /^Plan execution/ }) as HTMLButtonElement;
    expect(submit().disabled).toBe(true);
    expect(screen.getByText("Pick at least one approved case to cover.")).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox", { name: /TC-PLAN-0001/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /TC-PLAN-0002/ }));

    expect(submit().disabled).toBe(false);
    expect(screen.getByRole("button", { name: "Plan execution covering 2 cases" })).toBeTruthy();
  });

  it("shows each tester's open workload alongside their name", () => {
    render(<PlanForm cases={makeCases(3)} testers={TESTERS} />);

    expect(screen.getByRole("option", { name: "Ada Tester · 0 open" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Grace Tester · 4 open" })).toBeTruthy();
  });

  it("scopes the candidates to one product, and composes with the needle", () => {
    render(<PlanForm cases={makeCases(6)} testers={TESTERS} products={PRODUCTS} />);

    expect(screen.getAllByRole("checkbox")).toHaveLength(6);

    fireEvent.change(productBox(), { target: { value: "product-a" } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(screen.getByRole("checkbox", { name: /TC-PLAN-0001/ })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: /TC-PLAN-0002/ })).toBeNull();

    // The needle searches inside the product, not across the catalogue.
    fireEvent.change(filterBox(), { target: { value: "Candidate 3" } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  });

  it("keeps a selection the product filter has scoped out of view", () => {
    const { container } = render(
      <PlanForm cases={makeCases(6)} testers={TESTERS} products={PRODUCTS} />
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /TC-PLAN-0002/ }));
    fireEvent.change(productBox(), { target: { value: "product-a" } });

    // Case 2 belongs to the other product, so it leaves the screen — but not the run.
    expect(screen.queryByRole("checkbox", { name: /TC-PLAN-0002/ })).toBeNull();
    expect(screen.getByText(/1 case selected \(1 not shown\)/)).toBeTruthy();
    expect(submittedIds(container)).toEqual(["case-2"]);
  });

  it("names the product when its scope is what emptied the list", () => {
    render(<PlanForm cases={makeCases(6)} testers={TESTERS} products={PRODUCTS} />);

    fireEvent.change(productBox(), { target: { value: "product-a" } });
    fireEvent.change(filterBox(), { target: { value: "Autocomplete" } });

    expect(screen.getByText("Nothing matches “Autocomplete” in Storefront.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show all approved cases" }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(6);
    expect(productBox().value).toBe("");
  });

  /**
   * A single product still gets a dropdown. It cannot narrow anything today, but the
   * catalogue grows one product at a time and a filter that materialises by itself once
   * someone adds a second is a filter nobody knows to look for. The screen only offers
   * products that actually have an Approved case (`new/page.tsx`), so an option on
   * screen always has something behind it.
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
   * The needle is gated on the candidate list being long enough to be worth narrowing;
   * the product dropdown is not gated on that at all. Three approved cases spanning two
   * products is exactly the case the old shared gate got wrong — it hid the one control
   * that could have separated them.
   */
  it("offers the product filter on a short candidate list, without the needle", () => {
    render(<PlanForm cases={makeCases(3)} testers={TESTERS} products={PRODUCTS} />);

    expect(screen.queryByLabelText("Filter approved test cases")).toBeNull();
    expect(screen.getByLabelText("Filter by product")).toBeTruthy();

    fireEvent.change(productBox(), { target: { value: "product-b" } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  });

  /**
   * The filter sits INSIDE this form, so Enter would otherwise trigger the browser's
   * implicit submission and fire the real submit button — committing the run and
   * redirecting away from a keystroke meant to narrow a list. It only bites once
   * something is selected, because that is when the submit button stops being disabled,
   * which is exactly the moment someone filters again to look for the next case.
   */
  it("does not submit the run when Enter is pressed in the case filter", () => {
    render(<PlanForm cases={makeCases(6)} testers={TESTERS} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /TC-PLAN-0001/ }));

    // The submit is live now — the state in which implicit submission would fire.
    expect((screen.getByRole("button", { name: /^Plan execution/ }) as HTMLButtonElement).disabled)
      .toBe(false);

    const enter = fireEvent.keyDown(filterBox(), { key: "Enter", code: "Enter" });

    // `fireEvent` returns false when a handler called preventDefault(), which is what
    // stops the browser from submitting the form around the input.
    expect(enter).toBe(false);
  });
});
