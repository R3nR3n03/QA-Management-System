// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const nav = vi.hoisted(() => ({ search: "", replace: vi.fn() }));
const search = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  usePathname: () => "/test-cases",
  useSearchParams: () => new URLSearchParams(nav.search)
}));

import { NEEDLE_THRESHOLD, Picker, UrlPicker, type PickerGroup, type PickerOption } from "./picker";

/**
 * The one record-backed picker (ADR-0011). These are `FeaturePicker`'s tests, inherited: the
 * mechanics they cover — the hidden field, the debounce, the stale-response guard, Enter
 * ownership, the ARIA that must stop lying when the list closes — are the reason that component
 * was generalized rather than replaced.
 *
 * Two of its behaviours changed on purpose, and both are asserted below rather than quietly
 * dropped: Escape no longer releases the answer (clearing the needle is searching again, not
 * un-choosing), and the listbox opens on focus rather than on mount (four pickers on
 * `NewCaseForm` would otherwise be four open lists stacked down the form).
 *
 * The threshold is asserted on BOTH sides, because it is the one rule that changes which DOM a
 * caller gets. Note that testing-library maps a native `<select>` to `role="combobox"` too, so
 * these assert on the tag rather than the role — a role query cannot tell the two shapes apart.
 *
 * Every asserted string is the exact shipped wording, curly quotes included. A mismatch means
 * the TEST is wrong, never the component copy.
 */

const FEATURES: PickerOption[] = [
  { value: "feature-1", label: "FEAT007 Bulk upload", hint: "PROD001 Portal › MOD004 Upload" },
  { value: "feature-2", label: "FEAT012 Bulk upload", hint: "PROD002 Admin › MOD009 Files" }
];

/** `n` options, for standing either side of the threshold. */
const many = (n: number): PickerOption[] =>
  Array.from({ length: n }, (_, i) => ({ value: `id-${i}`, label: `PROD${String(i).padStart(3, "0")}` }));

const ZONES: PickerGroup[] = [
  { label: "Asia", options: [{ value: "Asia/Manila", label: "Asia/Manila (GMT+08:00)" }] },
  { label: "Europe", options: [{ value: "Europe/London", label: "Europe/London (GMT+00:00)" }] }
];

const hidden = (name = "featureId") => document.querySelector(`input[name="${name}"]`) as HTMLInputElement;
const box = () => screen.getByRole("combobox");
const open = () => fireEvent.focus(box());
const listbox = () => screen.queryByRole("listbox");

afterEach(cleanup);
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  search.mockReset();
  search.mockResolvedValue(FEATURES);
  nav.search = "";
  nav.replace.mockReset();
});

function mountSearch(extra: Record<string, unknown> = {}) {
  return render(<Picker label="Feature" name="featureId" search={search} {...extra} />);
}

describe("Picker — the searched list", () => {
  it("prefetches a first page before anything is typed", async () => {
    mountSearch();
    // The control exists for someone who cannot yet name what they want, so an empty needle is
    // a first page rather than "no search". Fetched on mount so the list is instant on focus.
    await waitFor(() => expect(search).toHaveBeenCalledWith(""));
  });

  it("opens on focus, not on mount", async () => {
    mountSearch();
    await waitFor(() => expect(search).toHaveBeenCalledWith(""));
    // `NewCaseForm` stacks four of these. Opening on mount would put four scrolling listboxes
    // down one form before anybody had asked a question.
    expect(listbox()).toBe(null);

    open();
    expect(await screen.findByRole("listbox")).toBeTruthy();
  });

  it("shows each candidate's disambiguating hint", async () => {
    mountSearch();
    open();
    // Both fixtures are called "Bulk upload" — exactly the collision that files a requirement
    // under the wrong feature and puts it in front of the wrong test cases.
    expect(await screen.findByText("PROD001 Portal › MOD004 Upload")).toBeTruthy();
    expect(screen.getByText("PROD002 Admin › MOD009 Files")).toBeTruthy();
  });

  it("posts nothing until something is chosen", async () => {
    mountSearch();
    open();
    await screen.findByText("FEAT007 Bulk upload");
    // An unchosen form must be refused by the domain rather than silently filed against
    // whatever happened to be first in the list.
    expect(hidden().value).toBe("");

    fireEvent.click(screen.getByText("FEAT007 Bulk upload").closest("button")!);
    expect(hidden().value).toBe("feature-1");
  });

  it("takes the active option on Enter without submitting the form", async () => {
    mountSearch();
    open();
    await screen.findByText("FEAT007 Bulk upload");

    fireEvent.keyDown(box(), { key: "ArrowDown" });
    const enter = fireEvent.keyDown(box(), { key: "Enter" });
    // `preventDefault` returns false from fireEvent. Without it, implicit submission posts a
    // form with nothing chosen from a keystroke that meant "take this one".
    expect(enter).toBe(false);
    expect(hidden().value).toBe("feature-2");
  });

  it("debounces typing into one query", async () => {
    mountSearch();
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
    const slow = [{ value: "stale", label: "FEAT999 Stale", hint: "old" }];
    let releaseSlow: (rows: typeof slow) => void = () => {};
    search.mockReturnValueOnce(new Promise((resolve) => (releaseSlow = resolve)));

    mountSearch();
    fireEvent.change(box(), { target: { value: "later" } });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    await screen.findByText("FEAT007 Bulk upload");

    await act(async () => {
      releaseSlow(slow);
    });
    expect(screen.queryByText("FEAT999 Stale")).toBe(null);
    expect(screen.getByText("FEAT007 Bulk upload")).toBeTruthy();
  });

  it("does not re-take a different option when Enter follows a pointer choice", async () => {
    mountSearch();
    open();
    await screen.findByText("FEAT012 Bulk upload");

    // Click the SECOND option, then press Enter as if to submit. `active` used to stay at 0
    // after a pointer choice, so Enter silently re-took the first result — a different feature
    // under a different product, which is the mis-filing `hint` exists to prevent.
    fireEvent.click(screen.getByText("FEAT012 Bulk upload").closest("button")!);
    expect(hidden().value).toBe("feature-2");

    fireEvent.keyDown(box(), { key: "Enter" });
    expect(hidden().value).toBe("feature-2");
  });

  it("gives Enter back to the form once something is chosen", async () => {
    mountSearch();
    open();
    await screen.findByText("FEAT007 Bulk upload");
    fireEvent.click(screen.getByText("FEAT007 Bulk upload").closest("button")!);

    // The listbox is gone, so the picker has nothing to act on and must stop swallowing Enter —
    // otherwise the only way to submit the form is to reach for the mouse.
    const enter = fireEvent.keyDown(box(), { key: "Enter" });
    expect(enter).toBe(true);
  });

  it("stops claiming to be an expanded combobox once the listbox is gone", async () => {
    mountSearch();
    open();
    await screen.findByText("FEAT007 Bulk upload");
    expect(box().getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(screen.getByText("FEAT007 Bulk upload").closest("button")!);
    // The list is replaced by the confirmation line, so a screen reader must not be told the
    // combobox is open with an active descendant that is not in the document.
    expect(box().getAttribute("aria-expanded")).toBe("false");
    expect(box().getAttribute("aria-activedescendant")).toBe(null);
  });

  it("returns to browsing on Escape without releasing the answer", async () => {
    mountSearch();
    open();
    await screen.findByText("FEAT007 Bulk upload");
    fireEvent.click(screen.getByText("FEAT007 Bulk upload").closest("button")!);
    expect(hidden().value).toBe("feature-1");

    fireEvent.keyDown(box(), { key: "Escape" });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    // `FeaturePicker` released the choice here. It must not: on a required field the only route
    // to empty would be a keystroke, and one stray Escape would unfile a requirement.
    expect(hidden().value).toBe("feature-1");
    expect((box() as HTMLInputElement).value).toBe("");
    expect(await screen.findByRole("listbox")).toBeTruthy();
  });
});

describe("Picker — the threshold decides the control", () => {
  it(`renders a native select at ${NEEDLE_THRESHOLD} options`, () => {
    const { container } = render(
      <Picker label="Product" name="productId" options={many(NEEDLE_THRESHOLD)} />
    );
    // The platform's control, while the list still fits: the OS picker, type-ahead and an
    // accessibility implementation nobody here maintains.
    expect(container.querySelector("select")).toBeTruthy();
    expect(container.querySelector('input[role="combobox"]')).toBe(null);
    // All of them rendered without anyone focusing anything.
    expect(screen.getAllByRole("option").length).toBe(NEEDLE_THRESHOLD + 1);
    expect(container.querySelector(".combo")?.getAttribute("data-shape")).toBe("select");
  });

  it(`switches to the combobox one option past ${NEEDLE_THRESHOLD}`, () => {
    const { container } = render(
      <Picker label="Product" name="productId" options={many(NEEDLE_THRESHOLD + 1)} />
    );
    expect(container.querySelector("select")).toBe(null);
    expect(container.querySelector('input[role="combobox"]')).toBeTruthy();
    expect(container.querySelector(".combo")?.getAttribute("data-shape")).toBe("combo");
    // The value still posts, from a hidden input rather than the select that is no longer there.
    expect(hidden("productId")).toBeTruthy();
  });

  it("always takes the combobox on the searched path, where the count is unknowable", () => {
    const { container } = render(<Picker label="Feature" name="featureId" search={search} />);
    expect(container.querySelector("select")).toBe(null);
    expect(container.querySelector('input[role="combobox"]')).toBeTruthy();
  });

  it("groups with optgroup below the threshold and with its own headings above", async () => {
    const { container, unmount } = render(
      <Picker label="Time zone" name="timeZone" options={ZONES} blank={{ label: "Follow the organization" }} />
    );
    // Two zones: the platform draws the groups.
    expect(container.querySelectorAll("optgroup").length).toBe(2);
    unmount();

    const big: PickerGroup[] = [
      { label: "Asia", options: many(6) },
      { label: "Europe", options: many(6).map((o) => ({ ...o, value: `eu-${o.value}` })) }
    ];
    render(<Picker label="Time zone" name="timeZone" options={big} />);
    open();
    // Twelve zones: our own listbox, and the group headings have to survive the move.
    expect(await screen.findByText("Asia")).toBeTruthy();
    expect(screen.getByText("Europe")).toBeTruthy();
  });
});

describe("Picker — blank is an answer, the needle is not", () => {
  it("keeps the blank row reachable when the needle matches nothing", async () => {
    render(
      <Picker
        label="Defect"
        name="defectId"
        options={many(NEEDLE_THRESHOLD + 1)}
        blank={{ label: "No defect" }}
      />
    );
    open();
    fireEvent.change(box(), { target: { value: "zzzz" } });

    // The way out of a wrong pick is needed exactly when someone is typing and finding nothing.
    // If the blank row were a search result it would vanish at the moment it is wanted.
    const blank = screen.getByText("No defect");
    expect(blank).toBeTruthy();
    fireEvent.click(blank.closest("button")!);
    expect(hidden("defectId").value).toBe("");
  });

  it("offers no blank row on a required field", () => {
    render(<Picker label="Product" name="productId" options={many(NEEDLE_THRESHOLD + 1)} />);
    open();
    // Nothing to click and nothing to arrow onto, so a required field cannot be emptied once
    // filled — which is the point. The domain still refuses an unfilled submit.
    expect(screen.queryByText("No defect")).toBe(null);
    expect(screen.getAllByRole("option").length).toBe(NEEDLE_THRESHOLD + 1);
  });

  it("leaves the answer alone when the needle is cleared by hand", () => {
    render(<Picker label="Product" name="productId" options={many(NEEDLE_THRESHOLD + 1)} />);
    open();
    fireEvent.click(screen.getByText("PROD003").closest("button")!);
    expect(hidden("productId").value).toBe("id-3");

    // Select-all-delete. Under the old model this silently unlinked the record.
    fireEvent.change(box(), { target: { value: "" } });
    expect(hidden("productId").value).toBe("id-3");
  });

  it("reads a blank answer back as the blank label rather than as unanswered", () => {
    render(
      <Picker
        label="Time zone"
        name="timeZone"
        options={many(NEEDLE_THRESHOLD + 1)}
        blank={{ label: "Follow the organization" }}
      />
    );
    // "" is a deliberate choice on a nullable field, so it is stated, not left to a placeholder.
    expect(screen.getByText("Follow the organization")).toBeTruthy();
    expect(hidden("timeZone").value).toBe("");
  });
});

describe("Picker — the states a caller drives", () => {
  it("states the answer instead of a box while disabled, and does not open", () => {
    const { container } = render(
      <Picker
        label="Requirement"
        name="requirementId"
        options={many(NEEDLE_THRESHOLD + 1)}
        value="id-4"
        disabled
      />
    );
    // A chained field whose parent is unchosen, or a form mid-submit. Either way a searchable
    // box that cannot answer invites typing into nothing.
    expect(container.querySelector('input[role="combobox"]')).toBe(null);
    expect(screen.getByText("PROD004")).toBeTruthy();
    // It still posts: disabling the control must not drop the answer the form already holds.
    expect(hidden("requirementId").value).toBe("id-4");
  });

  it("states the placeholder while disabled with nothing chosen", () => {
    render(
      <Picker
        label="Requirement"
        name="requirementId"
        options={many(NEEDLE_THRESHOLD + 1)}
        placeholder="Pick a feature first"
        disabled
      />
    );
    expect(screen.getByText("Pick a feature first")).toBeTruthy();
  });

  it("forwards a rejection onto the input and marks the field", () => {
    const { container } = render(
      <Picker
        label="Test case"
        name="testCaseId"
        options={many(NEEDLE_THRESHOLD + 1)}
        aria-invalid
        aria-describedby="new-defect-notice"
        aria-required
      />
    );
    // Call sites keep their existing `{...fieldProps(state, field, FORM_ID)}` spread verbatim,
    // which is the whole reason this is an ARIA passthrough rather than an `invalid` prop.
    expect(box().getAttribute("aria-describedby")).toBe("new-defect-notice");
    expect(box().getAttribute("aria-invalid")).toBe("true");
    // `aria-required` is all that is left of `required` above the threshold: a hidden input
    // cannot block submission, so the domain's refusal is the gate.
    expect(box().getAttribute("aria-required")).toBe("true");
    expect(container.querySelector(".combo")?.hasAttribute("data-bad")).toBe(true);
  });

  it("lets the caller own the value, for a chained field that has to reset", () => {
    const onChange = vi.fn();
    render(
      <Picker
        label="Module"
        name="moduleId"
        options={many(NEEDLE_THRESHOLD + 1)}
        value=""
        onChange={onChange}
      />
    );
    open();
    fireEvent.click(screen.getByText("PROD002").closest("button")!);
    // Reported, not absorbed: the parent resets its children off this, and the picker itself
    // stays ignorant of the chain.
    expect(onChange).toHaveBeenCalledWith("id-2");
    expect(hidden("moduleId").value).toBe("");
  });
});

describe("Picker — a row's copy", () => {
  const CODED: PickerOption[] = [
    { value: "prod-1", code: "PROD001", label: "Storefront" },
    ...many(NEEDLE_THRESHOLD).map((o) => ({ ...o, code: o.label, label: "Filler" }))
  ];

  it("keeps the business ID in its own .bid, as every other list in the app does", () => {
    const { container } = render(<Picker label="Product" name="productId" options={CODED} />);
    open();
    const bid = [...container.querySelectorAll(".bid")].find((n) => n.textContent === "PROD001");
    expect(bid).toBeTruthy();
    expect(screen.getByText("Storefront")).toBeTruthy();
  });

  it("joins the ID back onto the label in a native option, which cannot style its insides", () => {
    render(<Picker label="Product" name="productId" options={CODED.slice(0, 3)} />);
    // The exact copy those selects already shipped, so the conversion is invisible below the
    // threshold — `PROD001 · Storefront`, middot and all.
    expect((screen.getByRole("option", { name: "PROD001 · Storefront" }) as HTMLOptionElement).value).toBe(
      "prod-1"
    );
  });

  it("matches the needle against the ID and the hint, not only the label", () => {
    render(
      <Picker
        label="Product"
        name="productId"
        options={[...CODED, { value: "x", code: "PROD999", label: "Zebra", hint: "retired" }]}
      />
    );
    open();
    fireEvent.change(box(), { target: { value: "PROD999" } });
    // A row whose visible ID matches but whose name does not would otherwise vanish while the
    // reader is looking straight at the ID they typed.
    expect(screen.getByText("Zebra")).toBeTruthy();

    fireEvent.change(box(), { target: { value: "retired" } });
    expect(screen.getByText("Zebra")).toBeTruthy();
  });
});

describe("UrlPicker", () => {
  it("commits the choice to the query string and drops the page key", () => {
    nav.search = "page=4&q=login";
    render(<UrlPicker label="Filter by product" allLabel="All products" paramKey="productId" options={many(3)} />);

    fireEvent.change(screen.getByLabelText("Filter by product"), { target: { value: "id-1" } });
    // Narrowing while on page 4 would land on an empty page of a now-shorter list.
    expect(nav.replace).toHaveBeenCalledWith("/test-cases?q=login&productId=id-1", { scroll: false });
  });

  it("drops the parameter entirely when the reader picks the blank row", () => {
    nav.search = "productId=id-1";
    render(<UrlPicker label="Filter by product" allLabel="All products" paramKey="productId" options={many(3)} />);

    fireEvent.change(screen.getByLabelText("Filter by product"), { target: { value: "" } });
    // "All products" is a real value, and its URL is the one with no parameter at all.
    expect(nav.replace).toHaveBeenCalledWith("/test-cases", { scroll: false });
  });

  it("becomes a searchable listbox once the catalogue outgrows the threshold", () => {
    const { container } = render(
      <UrlPicker
        label="Filter by product"
        allLabel="All products"
        paramKey="productId"
        options={many(NEEDLE_THRESHOLD + 1)}
      />
    );
    expect(container.querySelector("select")).toBe(null);
    open();
    fireEvent.click(screen.getByText("PROD005").closest("button")!);
    expect(nav.replace).toHaveBeenCalledWith("/test-cases?productId=id-5", { scroll: false });
  });
});
