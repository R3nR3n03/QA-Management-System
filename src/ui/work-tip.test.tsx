// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  )
}));

import { WorkTipCard } from "./work-tip";
import type { WorkTip } from "./work-tips";

/**
 * The tip card's only behaviour is dismissal. It is asserted against real `localStorage`
 * (jsdom provides one) rather than a mock, because the thing worth proving is that the
 * choice OUTLIVES the component — a card that only hides until the next navigation would
 * be worse than no dismiss control at all.
 */

const TIP: WorkTip = {
  id: "narrow-the-queue",
  title: "Narrowing the queue",
  body: "The product and feature filters scope this list.",
  basis: "Describes this screen's own controls; no policy involved."
};

afterEach(cleanup);
beforeEach(() => localStorage.clear());

describe("WorkTipCard", () => {
  it("shows the tip it is handed", () => {
    render(<WorkTipCard tip={TIP} />);
    expect(screen.getByText("Narrowing the queue")).toBeTruthy();
  });

  it("renders an optional next step only when the tip carries one", () => {
    const { rerender } = render(<WorkTipCard tip={TIP} />);
    expect(screen.queryByRole("link")).toBe(null);

    rerender(<WorkTipCard tip={{ ...TIP, href: "/executions/new", linkLabel: "Plan a run" }} />);
    expect(screen.getByRole("link", { name: "Plan a run" }).getAttribute("href")).toBe(
      "/executions/new"
    );
  });

  it("dismisses for good, and stays dismissed on the next render", () => {
    const { unmount } = render(<WorkTipCard tip={TIP} />);

    // A named control, not a bare glyph: it throws something away permanently.
    fireEvent.click(screen.getByRole("button", { name: "Hide tips" }));
    expect(screen.queryByText("Narrowing the queue")).toBe(null);

    unmount();
    // A different tip, a fresh mount — still hidden. Dismissal is of the CARD, not of one
    // sentence: the tips are contextual, so per-tip dismissal would just surface the next
    // one tomorrow to someone who wanted the corner of their screen back.
    render(<WorkTipCard tip={{ ...TIP, id: "derived-result", title: "A run's result" }} />);
    expect(screen.queryByText("A run's result")).toBe(null);
  });

  it("survives storage that refuses to be read", () => {
    // Safari private browsing throws outright. This read runs during render, so an
    // unguarded one would take the whole screen down over a hint card.
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });

    expect(() => render(<WorkTipCard tip={TIP} />)).not.toThrow();
    expect(screen.getByText("Narrowing the queue")).toBeTruthy();
    getItem.mockRestore();
  });
});
