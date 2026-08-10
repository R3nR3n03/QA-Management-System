// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const search = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ searchFeaturesAction: search }));

import { FeaturePicker } from "./FeaturePicker";

/**
 * The parent picker for a requirement. Its job is to let someone file a requirement without
 * navigating two levels of tree to its feature, so these assert the three things that would
 * quietly break that: the hidden field the form actually posts, the ancestry that tells two
 * features apart, and the keyboard path.
 */

const CHOICES = [
  { id: "feature-1", businessId: "FEAT007", name: "Bulk upload", path: "PROD001 Portal › MOD004 Upload" },
  { id: "feature-2", businessId: "FEAT012", name: "Bulk upload", path: "PROD002 Admin › MOD009 Files" }
];

const hidden = () => document.querySelector('input[name="featureId"]') as HTMLInputElement;
const box = () => screen.getByRole("combobox");

afterEach(cleanup);
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  search.mockReset();
  search.mockResolvedValue(CHOICES);
});

function mount() {
  return render(<FeaturePicker name="featureId" label="Feature" formId="add-catalogue-child" />);
}

describe("FeaturePicker", () => {
  it("offers a first page before anything is typed", async () => {
    mount();
    // The control exists for someone who cannot yet name the feature they want, so an empty
    // box must still list candidates — a blank needle here is a first page, not "no search".
    await waitFor(() => expect(search).toHaveBeenCalledWith(""));
    expect(await screen.findByText("FEAT007")).toBeTruthy();
  });

  it("shows each candidate's ancestry, because the name alone does not identify one", async () => {
    mount();
    // Both fixtures are called "Bulk upload" — exactly the collision that files a requirement
    // under the wrong feature and puts it in front of the wrong test cases.
    expect(await screen.findByText("PROD001 Portal › MOD004 Upload")).toBeTruthy();
    expect(screen.getByText("PROD002 Admin › MOD009 Files")).toBeTruthy();
  });

  it("posts nothing until a feature is chosen", async () => {
    mount();
    await screen.findByText("FEAT007");
    // An unchosen form must fail on `featureId` in the domain rather than silently file the
    // requirement under whatever happened to be first in the list.
    expect(hidden().value).toBe("");

    fireEvent.click(screen.getByText("FEAT007").closest("button")!);
    expect(hidden().value).toBe("feature-1");
  });

  it("takes the active option on Enter without submitting the form", async () => {
    mount();
    await screen.findByText("FEAT007");

    fireEvent.keyDown(box(), { key: "ArrowDown" });
    const enter = fireEvent.keyDown(box(), { key: "Enter" });
    // `preventDefault` returns false from fireEvent. Without it, implicit submission posts a
    // form with no feature chosen from a keystroke that meant "take this one".
    expect(enter).toBe(false);
    expect(hidden().value).toBe("feature-2");
  });

  it("debounces typing into one query", async () => {
    mount();
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));

    fireEvent.change(box(), { target: { value: "up" } });
    fireEvent.change(box(), { target: { value: "upl" } });
    fireEvent.change(box(), { target: { value: "uplo" } });
    expect(search).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(search).toHaveBeenCalledTimes(2);
    expect(search).toHaveBeenLastCalledWith("uplo");
  });

  it("ignores a slow earlier response that lands after a newer one", async () => {
    // Server actions are not ordered. Without the guard the list flicks back to results for a
    // prefix the box no longer holds, which reads as the search being broken.
    const slow = [{ id: "stale", businessId: "FEAT999", name: "Stale", path: "old" }];
    let releaseSlow: (rows: typeof slow) => void = () => {};
    search.mockReturnValueOnce(new Promise((resolve) => (releaseSlow = resolve)));

    mount();
    fireEvent.change(box(), { target: { value: "later" } });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    await screen.findByText("FEAT007");

    await act(async () => {
      releaseSlow(slow);
    });
    expect(screen.queryByText("FEAT999")).toBe(null);
    expect(screen.getByText("FEAT007")).toBeTruthy();
  });

  it("does not re-file the requirement when Enter follows a pointer choice", async () => {
    mount();
    await screen.findByText("FEAT012");

    // Click the SECOND option, then press Enter as if to submit. `active` used to stay at 0
    // after a pointer choice, so Enter silently re-took the first search result — a different
    // feature under a different product, which is the mis-filing `path` exists to prevent.
    fireEvent.click(screen.getByText("FEAT012").closest("button")!);
    expect(hidden().value).toBe("feature-2");

    fireEvent.keyDown(box(), { key: "Enter" });
    expect(hidden().value).toBe("feature-2");
  });

  it("gives Enter back to the form once a feature is chosen", async () => {
    mount();
    await screen.findByText("FEAT007");
    fireEvent.click(screen.getByText("FEAT007").closest("button")!);

    // The listbox is gone, so the picker has nothing to act on and must stop swallowing
    // Enter — otherwise the only way to submit the form is to reach for the mouse.
    const enter = fireEvent.keyDown(box(), { key: "Enter" });
    expect(enter).toBe(true);
  });

  it("stops claiming to be an expanded combobox once the listbox is gone", async () => {
    mount();
    await screen.findByText("FEAT007");
    expect(box().getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(screen.getByText("FEAT007").closest("button")!);
    // The list is replaced by the confirmation line, so a screen reader must not be told the
    // combobox is open with an active descendant that is not in the document.
    expect(box().getAttribute("aria-expanded")).toBe("false");
    expect(box().getAttribute("aria-activedescendant")).toBe(null);
  });

  it("clears back to browsing on Escape", async () => {
    mount();
    await screen.findByText("FEAT007");
    fireEvent.click(screen.getByText("FEAT007").closest("button")!);
    expect(hidden().value).toBe("feature-1");

    fireEvent.keyDown(box(), { key: "Escape" });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    // The choice is released, so a wrong pick is one keystroke to undo rather than a reopen.
    expect(hidden().value).toBe("");
  });
});
