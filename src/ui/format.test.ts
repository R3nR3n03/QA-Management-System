import { HourFormat } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatMinute, hourClockFor, viewerStampFormat } from "./format";

/**
 * The seam between a person's stored preferences and the stamp they see.
 *
 * `viewerStampFormat` reads the environment for the organization zone, so these tests set
 * and restore `ORGANIZATION_TIME_ZONE` rather than assuming what a developer has in `.env`.
 */
const ORIGINAL = process.env.ORGANIZATION_TIME_ZONE;

beforeEach(() => {
  delete process.env.ORGANIZATION_TIME_ZONE;
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.ORGANIZATION_TIME_ZONE;
  else process.env.ORGANIZATION_TIME_ZONE = ORIGINAL;
});

describe("hourClockFor", () => {
  it("maps each stored choice to the Intl cycle", () => {
    expect(hourClockFor(HourFormat.H12)).toBe("h12");
    expect(hourClockFor(HourFormat.H24)).toBe("h23");
  });

  /**
   * `h23` and not `h24` for the 24-hour choice.
   *
   * Both are 24-hour clocks, but `h24` counts midnight as hour 24, so the first minute of a
   * day would read `24:00` — the same instant, printed as a time that looks like the day
   * after it.
   */
  it("resolves the 24-hour choice to h23, never h24", () => {
    expect(hourClockFor(HourFormat.H24)).not.toBe("h24");
  });

  // Never chosen resolves to what every screen rendered before the column existed.
  it("defaults to the 24-hour clock when nothing was chosen", () => {
    expect(hourClockFor(null)).toBe("h23");
  });
});

describe("viewerStampFormat", () => {
  it("takes both preferences from the person when they have set them", () => {
    process.env.ORGANIZATION_TIME_ZONE = "Asia/Manila";
    expect(viewerStampFormat({ timeZone: "Europe/Berlin", hourFormat: HourFormat.H12 })).toEqual({
      timeZone: "Europe/Berlin",
      clock: "h12"
    });
  });

  /**
   * The two preferences fall back DIFFERENTLY, and the asymmetry is deliberate.
   *
   * The zone chains through the deployment's own, because a Jira comment needs an
   * organization zone anyway. The clock has no such middle step — Jira is fixed at 24-hour,
   * so no deployment-level value exists to fall through to (ADR-0007).
   */
  it("falls the zone back to the organization's while the clock goes straight to the default", () => {
    process.env.ORGANIZATION_TIME_ZONE = "Asia/Manila";
    expect(viewerStampFormat({ timeZone: null, hourFormat: null })).toEqual({
      timeZone: "Asia/Manila",
      clock: "h23"
    });
  });

  // Nothing configured, nothing chosen: exactly what an untouched deployment rendered.
  it("terminates at UTC on a 24-hour clock", () => {
    expect(viewerStampFormat({ timeZone: null, hourFormat: null })).toEqual({
      timeZone: "UTC",
      clock: "h23"
    });
  });

  // One preference set and the other not is the ordinary case, not an edge one.
  it("resolves each preference independently", () => {
    process.env.ORGANIZATION_TIME_ZONE = "Asia/Manila";
    expect(viewerStampFormat({ timeZone: null, hourFormat: HourFormat.H12 })).toEqual({
      timeZone: "Asia/Manila",
      clock: "h12"
    });
    expect(viewerStampFormat({ timeZone: "Europe/Berlin", hourFormat: null })).toEqual({
      timeZone: "Europe/Berlin",
      clock: "h23"
    });
  });
});

describe("formatMinute", () => {
  const at = new Date("2026-08-17T06:30:00.000Z");

  // The one rendering every screen shares. A difference between two screens would be a bug.
  it("draws one instant on whichever clock and zone it is handed", () => {
    expect(formatMinute(at, { timeZone: "UTC", clock: "h23" })).toBe("2026-08-17 06:30");
    expect(formatMinute(at, { timeZone: "Asia/Manila", clock: "h23" })).toBe("2026-08-17 14:30");
    expect(formatMinute(at, { timeZone: "Asia/Manila", clock: "h12" })).toBe("2026-08-17 02:30 PM");
  });

  // No zone label on the stamp: it is stated once in the shell, not on every row.
  it("never labels the zone", () => {
    expect(formatMinute(at, { timeZone: "Asia/Manila", clock: "h23" })).not.toContain("Asia");
  });
});
