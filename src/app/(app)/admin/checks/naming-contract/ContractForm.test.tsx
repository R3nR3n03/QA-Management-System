// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PlanCandidate } from "@/ui/plan-grouping";
import { ContractForm, type ContractRun } from "./ContractForm";

/**
 * The picker itself is covered by `src/ui/case-picker.test.tsx`. This file is about the one
 * thing this form adds: starting from a run.
 *
 * The assertions are about what the form would POST and what it tells the reader, never about
 * what is visible in the picker — the filters and the render cap narrow the list, and neither
 * may narrow the contract.
 */

afterEach(cleanup);

const pad = (n: number) => String(n).padStart(4, "0");

function makeCases(count: number): PlanCandidate[] {
  return Array.from({ length: count }, (_, index) => {
    const n = index + 1;
    return {
      id: `case-${n}`,
      businessId: `TC-CON-${pad(n)}`,
      title: `Candidate ${n}`,
      priority: "High",
      severity: "Major",
      productId: "product-a",
      featureId: "feature-1",
      featureBusinessId: "FEAT001",
      requirementId: "req-1",
      requirementBusinessId: "REQ001",
      moduleName: "Checkout",
      featureName: "Card payment"
    };
  });
}

const run = (over: Partial<ContractRun> & { id: string }): ContractRun => ({
  businessId: "EXE-0042",
  purpose: "Sprint 24 regression, Chrome",
  caseIds: ["case-1", "case-2"],
  unavailable: 0,
  ...over
});

/** Every case id the form would actually submit: a ticked box or a hidden input. */
const submitted = () =>
  [...document.querySelectorAll<HTMLInputElement>('input[name="cases"]')]
    .filter((input) => input.type === "hidden" || input.checked)
    .map((input) => input.value)
    .sort();

const runSelect = () => screen.getByLabelText("Start from a run (optional)");

describe("ContractForm", () => {
  it("selects a run's cases when one is chosen", () => {
    render(
      <ContractForm
        cases={makeCases(4)}
        products={[]}
        preselect={[]}
        unavailable={0}
        runs={[run({ id: "run-1" })]}
      />
    );

    expect(submitted()).toEqual([]);
    fireEvent.change(runSelect(), { target: { value: "run-1" } });
    expect(submitted()).toEqual(["case-1", "case-2"]);
  });

  it("replaces the selection rather than adding to it", () => {
    render(
      <ContractForm
        cases={makeCases(4)}
        products={[]}
        preselect={["case-4"]}
        unavailable={0}
        runs={[run({ id: "run-1", caseIds: ["case-1"] })]}
      />
    );

    expect(submitted()).toEqual(["case-4"]);
    // "Start from" means start from — case-4 goes, rather than being folded in silently.
    fireEvent.change(runSelect(), { target: { value: "run-1" } });
    expect(submitted()).toEqual(["case-1"]);
  });

  it("empties the selection when the reader goes back to choosing by hand", () => {
    render(
      <ContractForm
        cases={makeCases(4)}
        products={[]}
        preselect={[]}
        unavailable={0}
        runs={[run({ id: "run-1" })]}
      />
    );

    fireEvent.change(runSelect(), { target: { value: "run-1" } });
    fireEvent.change(runSelect(), { target: { value: "" } });
    expect(submitted()).toEqual([]);
  });

  it("reports the chosen run's dropped cases, not the ones the URL arrived with", () => {
    render(
      <ContractForm
        cases={makeCases(4)}
        products={[]}
        preselect={["case-3"]}
        // Three cases were lost on the way in from `?cases=`.
        unavailable={3}
        runs={[run({ id: "run-1", unavailable: 1 })]}
      />
    );

    expect(screen.getByText(/3 cases could not be carried over/)).toBeTruthy();

    // Once a run supersedes that selection, its own count is the one that can be accounted for.
    fireEvent.change(runSelect(), { target: { value: "run-1" } });
    expect(screen.getByText(/1 case could not be carried over/)).toBeTruthy();
    expect(screen.queryByText(/3 cases could not be carried over/)).toBeNull();
  });

  it("says when the run list was cut at the limit, and stays quiet when it was not", () => {
    const { unmount } = render(
      <ContractForm
        cases={makeCases(4)}
        products={[]}
        preselect={[]}
        unavailable={0}
        runs={[run({ id: "run-1" })]}
        runsCapped
      />
    );
    expect(screen.getByText(/50 most recent runs/)).toBeTruthy();
    unmount();

    render(
      <ContractForm
        cases={makeCases(4)}
        products={[]}
        preselect={[]}
        unavailable={0}
        runs={[run({ id: "run-1" })]}
      />
    );
    expect(screen.queryByText(/50 most recent runs/)).toBeNull();
  });

  it("leaves the shortcut off entirely when no run can offer anything", () => {
    render(<ContractForm cases={makeCases(4)} products={[]} preselect={[]} unavailable={0} runs={[]} />);
    // A control with no usable options reads as broken; absent is the honest state.
    expect(screen.queryByLabelText("Start from a run (optional)")).toBeNull();
  });

  it("disables the submit until something is selected", () => {
    render(
      <ContractForm
        cases={makeCases(4)}
        products={[]}
        preselect={[]}
        unavailable={0}
        runs={[run({ id: "run-1" })]}
      />
    );

    expect(screen.getByRole("button", { name: /Download contract/ })).toHaveProperty("disabled", true);
    fireEvent.change(runSelect(), { target: { value: "run-1" } });
    expect(screen.getByRole("button", { name: /Download contract for 2 cases/ })).toHaveProperty(
      "disabled",
      false
    );
  });
});
