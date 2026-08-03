// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// `next/link` renders an anchor; `scroll` is a Link-only prop and must not reach the DOM.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    scroll: _scroll,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    scroll?: boolean;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  )
}));

import { Pager } from "./pager";

/**
 * The pager is links now, not callbacks: what it renders IS the navigation, so these
 * assert hrefs. The disabled ends are deliberately not links — an anchor with nowhere
 * to go is a trap for keyboard and screen-reader users. The pure math behind the range
 * labels stays covered in `paging.test.ts`.
 */

afterEach(cleanup);

const link = (name: string) => screen.getByRole("link", { name });

describe("Pager", () => {
  it("renders nothing while the list fits one page", () => {
    const { container } = render(<Pager total={50} page={1} pathname="/test-cases" params={{}} />);
    expect(container.innerHTML).toBe("");
  });

  it("reports the range and links forward, dropping `page=1` rather than writing it", () => {
    render(<Pager total={132} page={1} pathname="/test-cases" params={{}} />);

    expect(screen.getByText("Showing 1–50 of 132")).toBeTruthy();
    expect(link("Next").getAttribute("href")).toBe("/test-cases?page=2");
    // Page 1 has nowhere back to go, so Previous is not a link at all.
    expect(screen.queryByRole("link", { name: "Previous" })).toBeNull();
    expect(screen.getByText("Previous").getAttribute("aria-disabled")).toBe("true");
  });

  it("links both ways in the middle, and back to a bare path from page 2", () => {
    render(<Pager total={132} page={2} pathname="/test-cases" params={{ page: "2" }} />);

    expect(screen.getByText("Showing 51–100 of 132")).toBeTruthy();
    expect(link("Previous").getAttribute("href")).toBe("/test-cases");
    expect(link("Next").getAttribute("href")).toBe("/test-cases?page=3");
  });

  it("has no Next on the last page", () => {
    render(<Pager total={132} page={3} pathname="/test-cases" params={{ page: "3" }} />);

    expect(screen.getByText("Showing 101–132 of 132")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Next" })).toBeNull();
    expect(link("Previous").getAttribute("href")).toBe("/test-cases?page=2");
  });

  it("clamps an overshooting page for display instead of inventing pages", () => {
    render(<Pager total={132} page={900} pathname="/test-cases" params={{ page: "900" }} />);

    expect(screen.getByText("Showing 101–132 of 132")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Next" })).toBeNull();
  });

  it("carries the other parameters along, so a filtered list stays filtered", () => {
    render(<Pager total={132} page={1} pathname="/defects" params={{ q: "login" }} />);
    expect(link("Next").getAttribute("href")).toBe("/defects?q=login&page=2");
  });

  it("offers numbered jumps so the far end is not twenty clicks away", () => {
    // 1002 rows at 50 = 21 pages, the case that motivated numbered links.
    render(<Pager total={1002} page={1} pathname="/test-cases" params={{}} />);

    expect(link("Page 2").getAttribute("href")).toBe("/test-cases?page=2");
    expect(link("Page 21").getAttribute("href")).toBe("/test-cases?page=21");
    // The current page is not a link — you are already on it.
    expect(screen.queryByRole("link", { name: "Page 1" })).toBeNull();
    expect(screen.getByText("1").getAttribute("aria-current")).toBe("page");
  });

  it("keeps the current page a non-link in the middle of the range", () => {
    render(<Pager total={1002} page={10} pathname="/test-cases" params={{ page: "10" }} />);

    expect(screen.queryByRole("link", { name: "Page 10" })).toBeNull();
    expect(screen.getByText("10").getAttribute("aria-current")).toBe("page");
    expect(link("Page 9").getAttribute("href")).toBe("/test-cases?page=9");
    expect(link("Page 1").getAttribute("href")).toBe("/test-cases");
  });

  it("hides the rows-per-page control unless it is offered", () => {
    render(<Pager total={1002} page={1} pathname="/test-cases" params={{}} />);
    expect(screen.queryByRole("group", { name: "Rows per page of the list" })).toBeNull();
  });

  it("changing rows-per-page returns to page 1 and keeps other parameters", () => {
    render(
      <Pager
        total={1002}
        page={7}
        pathname="/test-cases"
        params={{ page: "7", q: "login" }}
        sizeOptions={[25, 50, 100]}
      />
    );

    // The page key is dropped: page 7 of 50-row pages is not page 7 of 100-row pages.
    expect(link("100").getAttribute("href")).toBe("/test-cases?q=login&size=100");
    expect(link("25").getAttribute("href")).toBe("/test-cases?q=login&size=25");
    // The default size clears the key rather than writing `size=50`.
    expect(screen.getByText("50").getAttribute("aria-current")).toBe("true");
  });

  it("still shows the size control on a list too short to page", () => {
    // Only one page, but changing to 25 rows would make it two — so the control stays
    // even though Prev/Next has nothing to do.
    render(<Pager total={30} page={1} pathname="/defects" params={{}} sizeOptions={[25, 50, 100]} />);

    expect(link("25").getAttribute("href")).toBe("/defects?size=25");
    expect(screen.queryByText("Previous")).toBeNull();
    expect(screen.queryByRole("link", { name: "Page 2" })).toBeNull();
  });

  it("pages against the chosen size, not the default", () => {
    render(
      <Pager total={1002} page={1} pathname="/test-cases" params={{ size: "100" }} pageSize={100} />
    );

    expect(screen.getByText("Showing 1–100 of 1002")).toBeTruthy();
    // 1002 at 100 per page is 11 pages, not 21.
    expect(link("Page 11").getAttribute("href")).toBe("/test-cases?size=100&page=11");
    expect(screen.queryByRole("link", { name: "Page 21" })).toBeNull();
  });

  it("uses its own page key so sibling lists page independently", () => {
    render(
      <Pager
        total={132}
        page={1}
        pathname="/catalogue"
        params={{ products: "4" }}
        pageKey="modules"
        label="modules"
      />
    );

    expect(screen.getByRole("navigation", { name: "Pages of the modules" })).toBeTruthy();
    expect(link("Next").getAttribute("href")).toBe("/catalogue?products=4&modules=2");
  });
});
