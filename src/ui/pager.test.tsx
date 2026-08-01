// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Pager } from "./pager";

/**
 * The pager control itself: visibility threshold, bounds, exact range labels (en
 * dash and all), and clamping of an out-of-range `page` prop. The pure math behind
 * it is covered in `paging.test.ts`; these tests cover what reaches the DOM.
 */

afterEach(cleanup);

describe("Pager", () => {
  it("renders nothing until the list exceeds one page", () => {
    const { container } = render(<Pager total={50} page={1} onPageChange={() => {}} />);

    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("appears past one page as a labelled nav, defaulting to \"list\"", () => {
    render(<Pager total={51} page={1} onPageChange={() => {}} />);

    expect(screen.getByRole("navigation", { name: "Pages of the list" })).toBeTruthy();
  });

  it("names the label it is given", () => {
    render(<Pager total={51} page={1} onPageChange={() => {}} label="widgets" />);

    expect(screen.getByRole("navigation", { name: "Pages of the widgets" })).toBeTruthy();
  });

  it("shows the exact range label at the first, middle, and last page", () => {
    const { rerender } = render(<Pager total={132} page={1} onPageChange={() => {}} />);
    expect(screen.getByText("Showing 1–50 of 132")).toBeTruthy();

    rerender(<Pager total={132} page={2} onPageChange={() => {}} />);
    expect(screen.getByText("Showing 51–100 of 132")).toBeTruthy();

    rerender(<Pager total={132} page={3} onPageChange={() => {}} />);
    expect(screen.getByText("Showing 101–132 of 132")).toBeTruthy();
  });

  it("disables Previous at the first page and Next at the last, as real buttons", () => {
    const { rerender } = render(<Pager total={132} page={1} onPageChange={() => {}} />);
    expect((screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(false);

    rerender(<Pager total={132} page={3} onPageChange={() => {}} />);
    expect((screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("reports the neighbouring page through onPageChange", () => {
    const onPageChange = vi.fn();
    render(<Pager total={132} page={2} onPageChange={onPageChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onPageChange).toHaveBeenLastCalledWith(3);

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(onPageChange).toHaveBeenLastCalledWith(1);
  });

  it("clamps an out-of-range page prop instead of rendering nonsense", () => {
    const onPageChange = vi.fn();
    const { rerender } = render(<Pager total={132} page={99} onPageChange={onPageChange} />);

    // Treated as the last page: label, bounds, and the Previous target all agree.
    expect(screen.getByText("Showing 101–132 of 132")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(onPageChange).toHaveBeenLastCalledWith(2);

    rerender(<Pager total={132} page={0} onPageChange={onPageChange} />);
    expect(screen.getByText("Showing 1–50 of 132")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("honours a custom pageSize for both threshold and label", () => {
    render(<Pager total={10} page={1} onPageChange={() => {}} pageSize={3} />);

    expect(screen.getByText("Showing 1–3 of 10")).toBeTruthy();
  });
});
