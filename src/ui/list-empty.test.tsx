// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  )
}));

import { ListEmpty } from "./list-empty";

/**
 * The empty body of a paged list. Two branches that must never be confused — the filters
 * matched nothing, or the offset overshot a list that has since shrunk — plus the nesting
 * rule the component learned the hard way.
 */

afterEach(cleanup);

describe("ListEmpty", () => {
  it("renders the caller's sentence when nothing matched", () => {
    render(
      <ListEmpty
        total={0}
        pathname="/my-work"
        params={{ q: "login" }}
        noMatch={<p>No run of yours matches “login”.</p>}
      />
    );

    expect(screen.getByText("No run of yours matches “login”.")).toBeTruthy();
    // The caller owns the reason, so the component must not also volunteer one.
    expect(screen.queryByText(/past the end/)).toBe(null);
  });

  it("reports an overshooting page instead of blaming a filter, and offers the way back", () => {
    render(
      <ListEmpty
        total={45}
        pathname="/my-work"
        params={{ page: "2", q: "login" }}
        noMatch={<p>No run of yours matches “login”.</p>}
      />
    );

    // `total > 0` means the filters DID match; only the offset is wrong. Printing the
    // caller's sentence here is what produced `Nothing matches “”.` above a pager saying
    // "Showing 1–45 of 45".
    expect(screen.getByText("This page is past the end of the list.")).toBeTruthy();
    expect(screen.queryByText(/No run of yours/)).toBe(null);
    // Prev/Next are computed from the clamped page and point back into this same empty
    // view, so this link is the only exit. It keeps the needle and drops the page.
    expect(screen.getByRole("link", { name: "Go to the first page" }).getAttribute("href")).toBe(
      "/my-work?q=login"
    );
  });

  it("does not wrap the caller's content, so a rich empty state stays valid HTML", () => {
    // The catalogue passes a block: a div with its own heading and paragraph. This used to
    // be rendered inside a `<p>`, where `<h3>` is not a permitted descendant — the browser
    // closed the paragraph early, the server and client trees disagreed, and every feature
    // with no requirements threw a hydration error.
    const { container } = render(
      <ListEmpty
        total={0}
        pathname="/catalogue"
        params={{}}
        noMatch={
          <div className="empty-rich">
            <h3>FEAT001 has no requirements yet.</h3>
            <p>Requirements are what the traceability matrix measures coverage against.</p>
          </div>
        }
      />
    );

    expect(container.querySelector("p h3")).toBe(null);
    expect(container.querySelector("p div")).toBe(null);
    expect(container.querySelector(".empty > .empty-rich")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "FEAT001 has no requirements yet." })).toBeTruthy();
  });
});
