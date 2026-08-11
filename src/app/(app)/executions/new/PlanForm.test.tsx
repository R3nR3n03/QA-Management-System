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

/**
 * Odd cases sit in product-a/Checkout/High, even ones in product-b/Search/Low, so the
 * filters have something to separate that is neither the ID nor the title. Requirements
 * split further within each product — product-a's odds split into req-1/req-2, product-b's
 * evens into req-3/req-4 — so a requirement filter has something to narrow that a product
 * filter alone would not. Feature sits one level of product-a/product-b here (one feature
 * per product, matching the existing "Card payment"/"Autocomplete" split) — a dedicated
 * `FEATURE_CASES` fixture below covers a product with more than one feature, since this
 * shared fixture is also depended on by every other test in the file.
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
 * product-a has two features here (unlike `makeCases`, which gives each product exactly
 * one) — feature-1 with two requirements, feature-2 with one — so a feature filter has
 * something to narrow within a product, and a requirement filter has something to narrow
 * within a feature. product-b's single feature/requirement is there so a product switch
 * has somewhere else to land.
 */
const FEATURE_CASES = [
  {
    id: "f-1",
    businessId: "TC-FEAT-0001",
    title: "Feature case 1",
    priority: "High",
    severity: "Major",
    productId: "product-a",
    featureId: "feature-1",
    featureBusinessId: "FEAT001",
    requirementId: "req-1",
    requirementBusinessId: "REQ001",
    moduleName: "Checkout",
    featureName: "Card payment"
  },
  {
    id: "f-2",
    businessId: "TC-FEAT-0002",
    title: "Feature case 2",
    priority: "High",
    severity: "Major",
    productId: "product-a",
    featureId: "feature-1",
    featureBusinessId: "FEAT001",
    requirementId: "req-2",
    requirementBusinessId: "REQ002",
    moduleName: "Checkout",
    featureName: "Card payment"
  },
  {
    id: "f-3",
    businessId: "TC-FEAT-0003",
    title: "Feature case 3",
    priority: "High",
    severity: "Major",
    productId: "product-a",
    featureId: "feature-2",
    featureBusinessId: "FEAT002",
    requirementId: "req-3",
    requirementBusinessId: "REQ003",
    moduleName: "Checkout",
    featureName: "Card refund"
  },
  {
    id: "f-4",
    businessId: "TC-FEAT-0004",
    title: "Feature case 4",
    priority: "Low",
    severity: "Minor",
    productId: "product-b",
    featureId: "feature-3",
    featureBusinessId: "FEAT003",
    requirementId: "req-4",
    requirementBusinessId: "REQ004",
    moduleName: "Search",
    featureName: "Autocomplete"
  },
  {
    id: "f-5",
    businessId: "TC-FEAT-0005",
    title: "Feature case 5",
    priority: "Low",
    severity: "Minor",
    productId: "product-b",
    featureId: "feature-3",
    featureBusinessId: "FEAT003",
    requirementId: "req-5",
    requirementBusinessId: "REQ005",
    moduleName: "Search",
    featureName: "Autocomplete"
  },
  {
    id: "f-6",
    businessId: "TC-FEAT-0006",
    title: "Feature case 6",
    priority: "Low",
    severity: "Minor",
    productId: "product-b",
    featureId: "feature-4",
    featureBusinessId: "FEAT004",
    requirementId: "req-6",
    requirementBusinessId: "REQ006",
    moduleName: "Search",
    featureName: "Autocomplete"
  }
];

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
const featureBox = () => screen.getByLabelText("Filter by feature") as HTMLSelectElement;
const requirementBox = () => screen.getByLabelText("Filter by requirement") as HTMLSelectElement;

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

  it("offers a requirement filter with no products prop at all", () => {
    render(<PlanForm cases={makeCases(6)} testers={TESTERS} />);

    expect(screen.getByRole("option", { name: "REQ001" })).toBeTruthy();
    fireEvent.change(requirementBox(), { target: { value: "req-1" } });
    // req-1 is cases 1 and 5.
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.getByRole("checkbox", { name: /TC-PLAN-0001/ })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: /TC-PLAN-0005/ })).toBeTruthy();
  });

  it("keeps a selection the requirement filter has scoped out of view", () => {
    const { container } = render(<PlanForm cases={makeCases(6)} testers={TESTERS} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /TC-PLAN-0003/ }));
    fireEvent.change(requirementBox(), { target: { value: "req-1" } });

    // Case 3 is req-2, so it leaves the screen — but not the run.
    expect(screen.queryByRole("checkbox", { name: /TC-PLAN-0003/ })).toBeNull();
    expect(screen.getByText(/1 case selected \(1 not shown\)/)).toBeTruthy();
    expect(submittedIds(container)).toEqual(["case-3"]);
  });

  it("composes the requirement filter with the needle", () => {
    render(<PlanForm cases={makeCases(6)} testers={TESTERS} />);

    fireEvent.change(requirementBox(), { target: { value: "req-1" } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);

    fireEvent.change(filterBox(), { target: { value: "Candidate 5" } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByRole("checkbox", { name: /TC-PLAN-0005/ })).toBeTruthy();
  });

  it("matches a requirement business ID by the needle alone", () => {
    render(<PlanForm cases={makeCases(6)} testers={TESTERS} />);

    fireEvent.change(filterBox(), { target: { value: "REQ002" } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByRole("checkbox", { name: /TC-PLAN-0003/ })).toBeTruthy();
  });

  /**
   * A product is the broader cut, so selecting one rescopes which requirements are even
   * worth offering — REQ003/REQ004 belong to product-b and would only ever produce an
   * empty list once product-a is chosen. The same reasoning `page.tsx` already applies
   * to products (drop what has no candidate behind it).
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
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);

    // req-3 belongs to product-b; switching to product-a would otherwise combine two
    // filters into a silent empty list with no explanation for either one.
    fireEvent.change(productBox(), { target: { value: "product-a" } });
    expect(requirementBox().value).toBe("");
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  });

  it("names the requirement when its scope is what emptied the list", () => {
    render(<PlanForm cases={makeCases(6)} testers={TESTERS} />);

    fireEvent.change(requirementBox(), { target: { value: "req-1" } });
    fireEvent.change(filterBox(), { target: { value: "Card payment" } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);

    fireEvent.change(filterBox(), { target: { value: "Autocomplete" } });
    expect(screen.getByText("Nothing matches “Autocomplete” in REQ001.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show all approved cases" }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(6);
    expect(requirementBox().value).toBe("");
  });

  it("names both scopes together when a product and a requirement combine to empty the list", () => {
    render(<PlanForm cases={makeCases(6)} testers={TESTERS} products={PRODUCTS} />);

    fireEvent.change(productBox(), { target: { value: "product-a" } });
    fireEvent.change(requirementBox(), { target: { value: "req-1" } });
    fireEvent.change(filterBox(), { target: { value: "Autocomplete" } });

    expect(screen.getByText("Nothing matches “Autocomplete” in Storefront · REQ001.")).toBeTruthy();
  });

  it("offers a feature filter with no products prop at all", () => {
    render(<PlanForm cases={makeCases(6)} testers={TESTERS} />);

    expect(screen.getByRole("option", { name: "FEAT001" })).toBeTruthy();
    fireEvent.change(featureBox(), { target: { value: "feature-1" } });
    // feature-1 is every odd case: 1, 3, 5.
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  });

  it("keeps a selection the feature filter has scoped out of view", () => {
    const { container } = render(<PlanForm cases={makeCases(6)} testers={TESTERS} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /TC-PLAN-0002/ }));
    fireEvent.change(featureBox(), { target: { value: "feature-1" } });

    // Case 2 is feature-2, so it leaves the screen — but not the run.
    expect(screen.queryByRole("checkbox", { name: /TC-PLAN-0002/ })).toBeNull();
    expect(screen.getByText(/1 case selected \(1 not shown\)/)).toBeTruthy();
    expect(submittedIds(container)).toEqual(["case-2"]);
  });

  it("composes the feature filter with the needle", () => {
    render(<PlanForm cases={makeCases(6)} testers={TESTERS} />);

    fireEvent.change(featureBox(), { target: { value: "feature-1" } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);

    fireEvent.change(filterBox(), { target: { value: "Candidate 5" } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByRole("checkbox", { name: /TC-PLAN-0005/ })).toBeTruthy();
  });

  /**
   * product-a has two features (feature-1: two requirements, feature-2: one) and
   * product-b has one — so this exercises both scoping steps at once: the product cut
   * decides which features are worth offering, and the feature cut then decides which
   * requirements are.
   */
  it("scopes feature options to the product, and requirement options to the feature", () => {
    render(<PlanForm cases={FEATURE_CASES} testers={TESTERS} products={PRODUCTS} />);

    expect(screen.getByRole("option", { name: "FEAT003" })).toBeTruthy();

    fireEvent.change(productBox(), { target: { value: "product-a" } });
    expect(screen.getByRole("option", { name: "FEAT001" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "FEAT002" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "FEAT003" })).toBeNull();

    // Both of product-a's requirements are offered until a feature narrows further.
    expect(screen.getByRole("option", { name: "REQ001" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "REQ003" })).toBeTruthy();

    fireEvent.change(featureBox(), { target: { value: "feature-1" } });
    expect(screen.getByRole("option", { name: "REQ001" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "REQ002" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "REQ003" })).toBeNull();
  });

  it("resets the feature and requirement filters when the product changes underneath them", () => {
    render(<PlanForm cases={FEATURE_CASES} testers={TESTERS} products={PRODUCTS} />);

    fireEvent.change(featureBox(), { target: { value: "feature-1" } });
    fireEvent.change(requirementBox(), { target: { value: "req-2" } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);

    // feature-1/req-2 both belong to product-a; switching to product-b would otherwise
    // combine three filters into a silent empty list with no explanation for any of them.
    fireEvent.change(productBox(), { target: { value: "product-b" } });
    expect(featureBox().value).toBe("");
    expect(requirementBox().value).toBe("");
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(screen.getByRole("checkbox", { name: /TC-FEAT-0004/ })).toBeTruthy();
  });

  it("resets the requirement filter when the feature changes underneath it", () => {
    render(<PlanForm cases={FEATURE_CASES} testers={TESTERS} products={PRODUCTS} />);

    fireEvent.change(requirementBox(), { target: { value: "req-2" } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);

    // req-2 belongs to feature-1; switching to feature-2 would otherwise empty the list
    // with no explanation, the same failure mode a product switch has to guard against.
    fireEvent.change(featureBox(), { target: { value: "feature-2" } });
    expect(requirementBox().value).toBe("");
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByRole("checkbox", { name: /TC-FEAT-0003/ })).toBeTruthy();
  });

  it("names the feature when its scope is what emptied the list", () => {
    render(<PlanForm cases={makeCases(6)} testers={TESTERS} />);

    fireEvent.change(featureBox(), { target: { value: "feature-1" } });
    fireEvent.change(filterBox(), { target: { value: "Autocomplete" } });

    expect(screen.getByText("Nothing matches “Autocomplete” in FEAT001.")).toBeTruthy();
  });

  it("names product, feature, and requirement together when all three combine to empty the list", () => {
    render(<PlanForm cases={FEATURE_CASES} testers={TESTERS} products={PRODUCTS} />);

    fireEvent.change(productBox(), { target: { value: "product-a" } });
    fireEvent.change(featureBox(), { target: { value: "feature-1" } });
    fireEvent.change(requirementBox(), { target: { value: "req-1" } });
    fireEvent.change(filterBox(), { target: { value: "nothing here" } });

    expect(
      screen.getByText("Nothing matches “nothing here” in Storefront · FEAT001 · REQ001.")
    ).toBeTruthy();
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
