// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const nav = vi.hoisted(() => ({ search: "", replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  usePathname: () => "/catalogue",
  useSearchParams: () => new URLSearchParams(nav.search)
}));

import { CatalogueSearch } from "./CatalogueSearch";

/**
 * The catalogue's search box. The debounce, the Escape-clear and the Back-button re-sync
 * belong to `UrlFilterToolbar` and are not re-tested here; what is specific to this screen
 * is the "/" shortcut and the announcement, and both have failure modes that are invisible
 * without a test — a shortcut that fires while you are typing eats the character, and a
 * live region that is only rendered when it has something to say is never announced.
 *
 * Every asserted string is the exact shipped wording, curly quotes included. A mismatch
 * means the TEST is wrong, never the component copy.
 */

afterEach(() => {
  cleanup();
  nav.search = "";
  nav.replace.mockClear();
});

const input = () => screen.getByLabelText("Search the catalogue") as HTMLInputElement;

describe("the / shortcut", () => {
  it("focuses the search box", () => {
    render(<CatalogueSearch matchCount={null} needle="" />);
    expect(document.activeElement).not.toBe(input());

    fireEvent.keyDown(document.body, { key: "/" });
    expect(document.activeElement).toBe(input());
  });

  // Without preventDefault the slash lands in the box it just focused, and every user's
  // first search begins with a stray "/".
  it("does not type the slash into the box it just focused", () => {
    render(<CatalogueSearch matchCount={null} needle="" />);
    const event = new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  // The whole point of a single-character shortcut is that it must never fire while the
  // viewer is entering text — in this box or any other field on the page.
  it("is ignored while focus is in a field", () => {
    render(
      <>
        <CatalogueSearch matchCount={null} needle="" />
        <textarea aria-label="Notes" />
      </>
    );
    const notes = screen.getByLabelText("Notes");
    notes.focus();

    fireEvent.keyDown(notes, { key: "/" });
    expect(document.activeElement).toBe(notes);
  });

  it("is ignored inside contenteditable", () => {
    render(<CatalogueSearch matchCount={null} needle="" />);
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    // jsdom does not implement isContentEditable from the attribute alone.
    Object.defineProperty(editable, "isContentEditable", { value: true });
    document.body.append(editable);

    fireEvent.keyDown(editable, { key: "/" });
    expect(document.activeElement).not.toBe(input());
  });

  // Modal traps focus and owns Escape; pulling focus out to the page behind an open
  // dialog would break the trap and leave the viewer typing into something they cannot see.
  it("is ignored while a modal is open", () => {
    render(<CatalogueSearch matchCount={null} needle="" />);
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.append(dialog);

    fireEvent.keyDown(document.body, { key: "/" });
    expect(document.activeElement).not.toBe(input());

    dialog.remove();
  });

  it("leaves modified slashes to the browser", () => {
    render(<CatalogueSearch matchCount={null} needle="" />);
    for (const modifier of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }]) {
      fireEvent.keyDown(document.body, { key: "/", ...modifier });
      expect(document.activeElement).not.toBe(input());
    }
  });

  it("stops listening once unmounted", () => {
    const { unmount } = render(<CatalogueSearch matchCount={null} needle="" />);
    unmount();
    // The assertion is that this does not throw by reaching into a torn-down tree.
    expect(() => fireEvent.keyDown(document.body, { key: "/" })).not.toThrow();
  });
});

describe("the match announcement", () => {
  const region = () => screen.getByRole("status");

  // A live region added to the page at the same moment its text appears is frequently not
  // announced — the region has to already exist for the change to BE a change.
  it("is present and empty when nothing has been searched", () => {
    render(<CatalogueSearch matchCount={null} needle="" />);
    expect(region()).toBeTruthy();
    expect(region().textContent).toBe("");
  });

  it("reports a count", () => {
    render(<CatalogueSearch matchCount={3} needle="check" />);
    expect(region().textContent).toBe("3 records match “check”.");
  });

  it("agrees with itself in the singular", () => {
    render(<CatalogueSearch matchCount={1} needle="3-D" />);
    expect(region().textContent).toBe("1 record matches “3-D”.");
  });

  // null and 0 are different answers: nothing was searched, versus a search that found
  // nothing. Saying "0 records match" for the first would be a lie about an idle box.
  it("distinguishes no search from no results", () => {
    const { unmount } = render(<CatalogueSearch matchCount={0} needle="zzz" />);
    expect(region().textContent).toBe("Nothing matches “zzz”.");
    unmount();

    render(<CatalogueSearch matchCount={0} needle="" />);
    expect(region().textContent).toBe("");
  });

  // The search is bounded, so the count on screen is a floor and not a total. Reporting
  // the cap as the answer — "40 records match" for a needle that matched four hundred —
  // is the one reading that is certainly wrong.
  it("says the list was cut rather than reporting the cap as a total", () => {
    render(<CatalogueSearch matchCount={40} truncated needle="00" />);
    expect(region().textContent).toBe("Showing the closest 40 of more matches for “00”.");
  });
});

describe("the URL it writes", () => {
  // The toolbar drops one page key per commit so a narrowed list cannot strand the viewer
  // past its end. On this screen that key is `c` — the detail panel's child list. Without
  // it: page to requirement 3, search, land on an empty page 3 of a shorter list.
  it("clears the child page when the needle changes", () => {
    nav.search = "sel=f%3AFEAT011&c=3";
    render(<CatalogueSearch matchCount={null} needle="" />);

    fireEvent.change(input(), { target: { value: "card" } });
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(nav.replace).toHaveBeenCalledTimes(1);
    const url = nav.replace.mock.calls[0][0] as string;
    expect(url).toContain("q=card");
    expect(url).not.toContain("c=");
  });

  // Search replaces the tree with a result list; it does not close the record being read.
  it("keeps the selection", () => {
    nav.search = "sel=f%3AFEAT011";
    render(<CatalogueSearch matchCount={null} needle="" />);

    fireEvent.change(input(), { target: { value: "card" } });
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(nav.replace.mock.calls[0][0]).toContain("sel=f%3AFEAT011");
  });
});
