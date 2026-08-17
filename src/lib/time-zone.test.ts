import { describe, expect, it } from "vitest";
import {
  formatInZone,
  formatInZoneWithName,
  isSupportedTimeZone,
  supportedTimeZones,
  timeZoneChoices,
  UTC
} from "./time-zone";

describe("formatInZone", () => {
  const at = new Date("2026-08-17T06:30:00.000Z");

  it("renders the wall clock of the zone it is given", () => {
    expect(formatInZone(at, "UTC", "h23")).toBe("2026-08-17 06:30");
    expect(formatInZone(at, "Asia/Manila", "h23")).toBe("2026-08-17 14:30");
  });

  // Same instant, a different calendar DAY on the other side of the line. This is the case a
  // naive `toISOString().slice(0, 10)` gets wrong, which is exactly what the Jira connection
  // panel used to do (ADR-0007).
  it("crosses the date boundary rather than only shifting the clock", () => {
    const lateUtc = new Date("2026-08-17T18:00:00.000Z");
    expect(formatInZone(lateUtc, "Asia/Manila", "h23")).toBe("2026-08-18 02:00");

    const earlyUtc = new Date("2026-08-17T02:00:00.000Z");
    expect(formatInZone(earlyUtc, "America/New_York", "h23")).toBe("2026-08-16 22:00");
  });

  /**
   * Midnight is `00:00`, never `24:00`.
   *
   * `hour12: false` produces `24` on some engines — the same instant, printed as a time that
   * reads like the day after it. `hourCycle: "h23"` is what stops that, and this is the test
   * that would catch its removal.
   */
  it("renders midnight as 00:00", () => {
    expect(formatInZone(new Date("2026-08-17T00:00:00.000Z"), "UTC", "h23")).toBe("2026-08-17 00:00");
    // 16:00 UTC is midnight in Manila.
    expect(formatInZone(new Date("2026-08-16T16:00:00.000Z"), "Asia/Manila", "h23")).toBe(
      "2026-08-17 00:00"
    );
  });

  // A zone that observes DST resolves against the instant, which is the whole reason the
  // design stores an IANA name rather than a fixed offset.
  it("applies the offset in force at that instant, not a fixed one", () => {
    const summer = new Date("2026-07-01T12:00:00.000Z");
    const winter = new Date("2026-01-01T12:00:00.000Z");
    expect(formatInZone(summer, "Europe/London", "h23")).toBe("2026-07-01 13:00");
    expect(formatInZone(winter, "Europe/London", "h23")).toBe("2026-01-01 12:00");
  });

  it("renders a 12-hour clock with a zero-padded hour and a period", () => {
    expect(formatInZone(at, "Asia/Manila", "h12")).toBe("2026-08-17 02:30 PM");
    expect(formatInZone(at, "UTC", "h12")).toBe("2026-08-17 06:30 AM");
  });

  /**
   * Padded on both clocks, because these stamps sit in list columns.
   *
   * An unpadded `2:30 PM` beside `11:45 AM` moves the colon a character between rows, which
   * costs more in scannability than the leading zero costs in noise (ADR-0007). This is the
   * assertion that would catch a switch to `hour12: true`, where several engines drop the
   * `2-digit` request.
   */
  it("pads the 12-hour hour rather than rendering a single digit", () => {
    const nine = new Date("2026-08-17T01:05:00.000Z");
    expect(formatInZone(nine, "Asia/Manila", "h12")).toBe("2026-08-17 09:05 AM");
    expect(formatInZone(nine, "Asia/Manila", "h12")).not.toContain(" 9:05");
  });

  /**
   * The two edges a 12-hour clock gets wrong: midnight is `12:00 AM`, not `00:00 AM`, and
   * noon is `12:00 PM`, not `00:00 PM`. `h12` is what gets both right — `h11` would render
   * midnight as `00:00 AM`.
   */
  it("renders midnight and noon correctly on a 12-hour clock", () => {
    // 16:00 UTC is midnight in Manila; 04:00 UTC is noon there.
    expect(formatInZone(new Date("2026-08-16T16:00:00.000Z"), "Asia/Manila", "h12")).toBe(
      "2026-08-17 12:00 AM"
    );
    expect(formatInZone(new Date("2026-08-17T04:00:00.000Z"), "Asia/Manila", "h12")).toBe(
      "2026-08-17 12:00 PM"
    );
  });

  // The clock changes only the time, never the date part or the zone maths.
  it("keeps the same calendar day on either clock", () => {
    const lateUtc = new Date("2026-08-17T18:00:00.000Z");
    expect(formatInZone(lateUtc, "Asia/Manila", "h23")).toBe("2026-08-18 02:00");
    expect(formatInZone(lateUtc, "Asia/Manila", "h12")).toBe("2026-08-18 02:00 AM");
  });
});

describe("formatInZoneWithName", () => {
  // For a reader who has no shell to state the zone in — a stranger in Jira.
  it("carries the zone name in the text", () => {
    expect(formatInZoneWithName(new Date("2026-08-17T06:30:00.000Z"), "Asia/Manila")).toBe(
      "2026-08-17 14:30 Asia/Manila"
    );
  });

  /**
   * Fixed at 24-hour, with no clock argument to pass.
   *
   * `14:30 Asia/Manila` is already unambiguous to a stranger and `02:30 PM Asia/Manila` is
   * strictly more to parse — in a ticket that may equally be read by a script. There is no
   * question here for a deployment or a viewer to answer, which is why this function takes
   * no clock at all rather than defaulting one (ADR-0007).
   */
  it("takes no clock and is never on a 12-hour one", () => {
    const afternoon = formatInZoneWithName(new Date("2026-08-17T06:30:00.000Z"), "Asia/Manila");
    expect(afternoon).not.toContain("PM");
    expect(afternoon).not.toContain("AM");
  });
});

describe("isSupportedTimeZone", () => {
  it("accepts canonical IANA names", () => {
    expect(isSupportedTimeZone("Asia/Manila")).toBe(true);
    expect(isSupportedTimeZone("Europe/London")).toBe(true);
  });

  // The terminal fallback of every chain in the codebase, so its absence would be a silent
  // failure at first render rather than a loud one here.
  it("accepts UTC", () => {
    expect(isSupportedTimeZone(UTC)).toBe(true);
  });

  it("rejects misspellings, offsets and abbreviations", () => {
    expect(isSupportedTimeZone("Asia/Manilla")).toBe(false);
    expect(isSupportedTimeZone("+08:00")).toBe(false);
    expect(isSupportedTimeZone("PHT")).toBe(false);
    expect(isSupportedTimeZone("")).toBe(false);
  });
});

describe("supportedTimeZones", () => {
  it("offers a sorted list the picker can render", () => {
    const zones = supportedTimeZones();
    expect(zones.length).toBeGreaterThan(100);
    expect(zones).toContain("Asia/Manila");
    expect([...zones].sort((a, b) => a.localeCompare(b))).toEqual(zones);
  });

  // Every name the picker offers must be one the domain service will accept, or a viewer can
  // choose a zone that is then rejected on save.
  it("offers only names the validator accepts", () => {
    expect(supportedTimeZones().every(isSupportedTimeZone)).toBe(true);
  });
});

describe("timeZoneChoices", () => {
  // Northern-hemisphere summer, so the two zones below are on opposite sides of a DST rule.
  const summer = new Date("2026-08-17T06:30:00.000Z");
  const winter = new Date("2026-01-17T06:30:00.000Z");

  const find = (at: Date, value: string) =>
    timeZoneChoices(at)
      .flatMap((group) => group.zones)
      .find((zone) => zone.value === value);

  it("labels a zone with the offset it is on, name first", () => {
    expect(find(summer, "Asia/Manila")?.label).toBe("Asia/Manila (GMT+08:00)");
  });

  // The reason the instant is an argument. A stored offset would be wrong for half the year.
  it("moves an offset across a daylight-saving boundary", () => {
    expect(find(summer, "Europe/London")?.label).toBe("Europe/London (GMT+01:00)");
    expect(find(winter, "Europe/London")?.label).toBe("Europe/London (GMT+00:00)");
  });

  // `longOffset` spells zero as a bare `GMT`, which reads as "no offset known" in a column of
  // real ones.
  it("writes zero out in full", () => {
    expect(find(summer, UTC)?.label).toBe("UTC (GMT+00:00)");
  });

  it("groups by region, with UTC first because it belongs to none of them", () => {
    const groups = timeZoneChoices(summer);
    expect(groups[0]).toEqual({ region: "Universal", zones: [{ value: UTC, label: "UTC (GMT+00:00)" }] });
    expect(groups.map((group) => group.region)).toContain("Asia");
    expect(groups.find((group) => group.region === "Asia")?.zones.every((zone) => zone.value.startsWith("Asia/"))).toBe(
      true
    );
  });

  // The same guarantee `supportedTimeZones` carries: a picker must not offer a value the
  // domain will reject, and grouping is the one thing between the two.
  it("offers every supported zone, exactly once, and nothing else", () => {
    const offered = timeZoneChoices(summer).flatMap((group) => group.zones.map((zone) => zone.value));
    expect([...offered].sort((a, b) => a.localeCompare(b))).toEqual(supportedTimeZones());
    expect(offered.every(isSupportedTimeZone)).toBe(true);
  });

  it("caches within the hour and rebuilds across one", () => {
    expect(timeZoneChoices(summer)).toBe(timeZoneChoices(new Date("2026-08-17T06:59:59.999Z")));
    expect(timeZoneChoices(summer)).not.toBe(timeZoneChoices(new Date("2026-08-17T07:00:00.000Z")));
  });
});
