// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HourFormat } from "@prisma/client";

// The domain owns which zones are legal and what a change costs; this is the picker in front
// of it. See `src/lib/time-zone.test.ts` for the list itself.
vi.mock("./actions", () => ({ changeDisplayPreferencesAction: vi.fn(async () => null) }));

import { DisplayPreferencesForm } from "./DisplayPreferencesForm";
import type { TimeZoneGroup } from "@/lib/time-zone";

/**
 * Neither control shows its own effect: `Asia/Manila` and `H12` are stored values, not the
 * thing a reader is choosing between. What these pin is the echo — the stamp the choices
 * actually produce, moving as they move.
 */

const ZONES: TimeZoneGroup[] = [
  { region: "Universal", zones: [{ value: "UTC", label: "UTC (GMT+00:00)" }] },
  {
    region: "Asia",
    zones: [
      { value: "Asia/Makassar", label: "Asia/Makassar (GMT+08:00)" },
      { value: "Asia/Manila", label: "Asia/Manila (GMT+08:00)" }
    ]
  }
];

const NOW = "2026-08-17T06:30:00.000Z";

const form = (props: Partial<React.ComponentProps<typeof DisplayPreferencesForm>> = {}) => (
  <DisplayPreferencesForm
    timeZone={null}
    hourFormat={null}
    zones={ZONES}
    organizationZone="UTC"
    nowIso={NOW}
    {...props}
  />
);

afterEach(cleanup);

describe("DisplayPreferencesForm", () => {
  it("previews the stamp the stored preferences already produce", () => {
    render(form({ timeZone: "Asia/Manila", hourFormat: HourFormat.H12 }));

    expect(screen.getByText("2026-08-17 02:30 PM")).toBeTruthy();
  });

  it("moves the preview with either control", () => {
    render(form({ timeZone: "Asia/Manila", hourFormat: HourFormat.H12 }));

    fireEvent.change(screen.getByLabelText("Clock"), { target: { value: HourFormat.H24 } });
    expect(screen.getByText("2026-08-17 14:30")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Time zone"), { target: { value: "UTC" } });
    expect(screen.getByText("2026-08-17 06:30")).toBeTruthy();
  });

  // "No preference" is a real choice, not an empty field: it means "follow the organization",
  // and the preview has to show what that resolves to rather than nothing at all.
  it("previews the organization's zone when no preference is set", () => {
    render(form({ organizationZone: "Asia/Manila" }));

    expect(screen.getByText("2026-08-17 14:30")).toBeTruthy();
  });

  it("offers the zones grouped, labelled with their offset, and valued by IANA name", () => {
    const { container } = render(form());

    expect([...container.querySelectorAll("optgroup")].map((group) => group.label)).toEqual([
      "Universal",
      "Asia"
    ]);

    // The label is what a reader chooses by; the value is the only part the domain ever sees.
    const manila = screen.getByRole("option", { name: "Asia/Manila (GMT+08:00)" }) as HTMLOptionElement;
    expect(manila.value).toBe("Asia/Manila");
  });
});
