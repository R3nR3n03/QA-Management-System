// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PagedList } from "./paged-list";

/**
 * The server-rendered-rows wrapper: slicing, the walk through pages, the `.empty`
 * fallback, and the pager's auto-hide when everything fits on one page. A small
 * `pageSize` keeps the fixtures readable — PagedList is the one list piece that
 * accepts one.
 */

afterEach(cleanup);

const items = (count: number) =>
  Array.from({ length: count }, (_, index) => <span key={index}>Item {index + 1}</span>);

describe("PagedList", () => {
  it("renders the first slice and walks the remainder with Next", () => {
    render(<PagedList items={items(7)} pageSize={3} />);

    expect(screen.getByText("Item 1")).toBeTruthy();
    expect(screen.getByText("Item 3")).toBeTruthy();
    expect(screen.queryByText("Item 4")).toBeNull();
    expect(screen.getByText("Showing 1–3 of 7")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Item 4")).toBeTruthy();
    expect(screen.getByText("Item 6")).toBeTruthy();
    expect(screen.queryByText("Item 1")).toBeNull();
    expect(screen.queryByText("Item 7")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Item 7")).toBeTruthy();
    expect(screen.queryByText("Item 6")).toBeNull();
    expect(screen.getByText("Showing 7–7 of 7")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders the .empty state when empty and emptyText is given", () => {
    const { container } = render(<PagedList items={[]} emptyText="None yet." />);

    const empty = container.querySelector(".empty");
    expect(empty).toBeTruthy();
    expect(screen.getByText("None yet.")).toBeTruthy();
  });

  it("renders nothing when empty without emptyText", () => {
    const { container } = render(<PagedList items={[]} />);

    expect(container.firstChild).toBeNull();
  });

  it("hides the pager when the items fit on one page", () => {
    render(<PagedList items={items(3)} pageSize={3} />);

    expect(screen.getByText("Item 1")).toBeTruthy();
    expect(screen.getByText("Item 3")).toBeTruthy();
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});
