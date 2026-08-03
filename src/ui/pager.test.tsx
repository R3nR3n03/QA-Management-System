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
