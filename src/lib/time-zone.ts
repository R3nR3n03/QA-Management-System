/**
 * Rendering an instant in a named zone, and deciding which names are real.
 *
 * Every timestamp QAMS holds is a UTC instant (`docs/data-model.md`), and that is unchanged.
 * This module is the presentation edge: it is where an instant stops being a point on the
 * line and becomes a wall clock somebody reads.
 *
 * Two zones exist and they are not interchangeable — the **organization zone**
 * (`src/lib/app-config.ts`) and the **viewer zone** (`User.timeZone`). `CONTEXT.md` defines
 * both, and [ADR-0007](../../docs/adr/0007-a-zone-for-readers-and-a-zone-for-outsiders.md)
 * records why they are separate. Nothing here chooses between them: callers pass the one
 * they mean, which is the point of taking the zone as an argument rather than reaching for
 * a default.
 *
 * Pure — no environment, no database, no `next/*`. Unit-testable on its own.
 */

/** What every fallback chain terminates at, and what an unconfigured deployment renders. */
export const UTC = "UTC";

/**
 * Which clock a stamp is drawn on, as `Intl` names it.
 *
 * Deliberately NOT the `HourFormat` enum from `@prisma/client`. This module is reachable from
 * `src/instrumentation.ts`, which Next compiles for the Edge runtime as well as Node, and
 * webpack resolves the module graph at build time regardless of any runtime guard — the trap
 * documented at length in that file and in `src/middleware.ts`. Pulling the Prisma client into
 * this graph is exactly what that warning is about. The enum is mapped to one of these two
 * strings in `src/ui/format.ts`, which is never in the Edge graph.
 *
 * `h23` and not `h24`: both render a 24-hour clock, but `h24` counts midnight as hour 24, so
 * the first minute of a day would read `24:00` — the same instant, printed as a time that
 * looks like the day after it.
 */
export type HourClock = "h12" | "h23";

/** What a reader who has expressed no preference sees, and what every screen rendered before. */
export const DEFAULT_HOUR_CLOCK: HourClock = "h23";

/**
 * The canonical IANA zone names this runtime can actually format, built once.
 *
 * `Intl.supportedValuesOf` is the platform's own list, which is the reason to use it: a
 * hand-kept list of "zones we support" would be a second thing to maintain and would be
 * wrong the first time a country changed its mind. It returns canonical names only, so an
 * alias like `Asia/Calcutta` is rejected in favour of `Asia/Kolkata` — deliberate, because
 * storing two spellings of one zone would make two viewers look different in the database
 * while seeing identical clocks.
 */
let supported: Set<string> | null = null;

function supportedZones(): Set<string> {
  if (supported === null) {
    supported = new Set(Intl.supportedValuesOf("timeZone"));
    // Present in the spec's list, but asserted rather than assumed: it is the terminal
    // fallback of every chain in this codebase, so a runtime without it must fail loudly
    // here instead of silently at the first render.
    supported.add(UTC);
  }
  return supported;
}

/** Whether `value` is a zone name this runtime recognises. */
export function isSupportedTimeZone(value: string): boolean {
  return supportedZones().has(value);
}

/**
 * Every zone name a person may choose, sorted — for the picker on `/account`.
 *
 * Returned rather than rendered so the screen decides how to present ~400 entries; that is
 * presentation and not a constraint (ADR-0007).
 */
export function supportedTimeZones(): string[] {
  return [...supportedZones()].sort((a, b) => a.localeCompare(b));
}

/** One option in the zone picker. */
export type TimeZoneChoice = {
  /** The canonical IANA name. The only part that is ever submitted, stored or validated. */
  value: string;
  /** `Asia/Manila (GMT+08:00)` — what a reader chooses by. */
  label: string;
};

/** The options under one `<optgroup>`. */
export type TimeZoneGroup = {
  /** `Asia`, `Europe`, … — the text before the first slash, or `Universal` for UTC. */
  region: string;
  zones: TimeZoneChoice[];
};

/** What UTC is filed under: it names no place, so it belongs in none of the regions. */
const UNIVERSAL = "Universal";

let choiceCache: { hour: number; groups: TimeZoneGroup[] } | null = null;

/**
 * Every supported zone, grouped by region and labelled with the offset it is on at `at` —
 * the same list `supportedTimeZones` returns, in the shape a picker can actually be read in.
 *
 * ## Why the offset is computed and not stored
 *
 * An offset is not a property of a zone; it is a property of a zone AT AN INSTANT.
 * `Europe/London` is GMT+00:00 in January and GMT+01:00 in July, so a table of offsets would
 * be wrong for half of every year. The instant is an argument for the same reason
 * `formatInZone` takes one: nothing in this module reads the clock for itself.
 *
 * ## Why the label leads with the IANA name
 *
 * A native `<select>` of four hundred options is navigated by typing, and typing matches the
 * START of a label. `(GMT+08:00) Manila` reads better on the closed control and cannot be
 * typed to at all — every option would begin with the same bracket. So the name leads, and
 * the offset follows it as the thing that separates two names a reader cannot choose between.
 *
 * ## The cache
 *
 * Building this constructs one `Intl.DateTimeFormat` per zone, around 80ms for the ~420 the
 * runtime knows. Cached for the UTC hour `at` falls in, so the account screen pays it once an
 * hour rather than once a render. An hour-stale entry can only ever be wrong about a LABEL
 * across a DST boundary; the value a viewer picks is the zone name, which no offset affects.
 */
export function timeZoneChoices(at: Date): TimeZoneGroup[] {
  const hour = Math.floor(at.getTime() / 3_600_000);
  if (choiceCache !== null && choiceCache.hour === hour) return choiceCache.groups;

  const universal: TimeZoneChoice[] = [];
  const byRegion = new Map<string, TimeZoneChoice[]>();

  for (const value of supportedTimeZones()) {
    const choice: TimeZoneChoice = { value, label: `${value} (${gmtOffset(value, at)})` };
    const slash = value.indexOf("/");
    if (slash === -1) {
      universal.push(choice);
      continue;
    }
    const region = value.slice(0, slash);
    const existing = byRegion.get(region);
    if (existing === undefined) byRegion.set(region, [choice]);
    else existing.push(choice);
  }

  // UTC leads. It sorts last of four hundred names, and it is the one zone somebody picks
  // deliberately rather than by hunting for their own city — so it is the one that must not
  // be at the bottom. Everything after it keeps the source list's alphabetical order, both
  // between regions (Map preserves insertion) and within one.
  const groups: TimeZoneGroup[] = [];
  if (universal.length > 0) groups.push({ region: UNIVERSAL, zones: universal });
  for (const [region, zones] of byRegion) groups.push({ region, zones });

  choiceCache = { hour, groups };
  return groups;
}

/** `GMT+08:00` — the offset `timeZone` is on at `at`, in the spelling `Intl` gives it. */
function gmtOffset(timeZone: string, at: Date): string {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((part) => part.type === "timeZoneName")?.value;
  // `longOffset` renders zero as a bare `GMT`. Spelled out so a column of offsets stays
  // aligned, and so the zero case never reads as "no offset known".
  return name === undefined || name === "GMT" ? "GMT+00:00" : name;
}

/**
 * `2026-08-17 14:30`, or `2026-08-17 02:30 PM` on a 12-hour clock — one instant, on the wall
 * clock of one zone, to the minute.
 *
 * Assembled from `formatToParts` rather than a locale pattern, and that is not fussiness.
 * `toLocaleString` with any real locale interleaves the fields differently, so the output
 * would depend on where the process runs — the exact property `jira-comment.ts` protected
 * by hand-slicing an ISO string before this module existed. Naming each part explicitly
 * means the shape is fixed by this function and by nothing else.
 *
 * The hour is zero-padded on both clocks. These stamps sit in list columns, and an unpadded
 * `2:30 PM` beside a padded `11:45 AM` moves the colon a character between rows, which costs
 * more in scannability than the leading zero does in noise. `Intl` supplies the padded form
 * for `h12` as well as `h23`, so nothing here has to pad by hand.
 *
 * Both arguments are required on purpose. A default for either would be another place that
 * decides how a reader sees a stamp, and the design deliberately has exactly one per
 * question: the zone chain in `app-config.ts`, and the clock in `src/ui/format.ts`.
 */
export function formatInZone(value: Date, timeZone: string, clock: HourClock): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: clock
  }).formatToParts(value);

  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((one) => one.type === type)?.value ?? "";

  const clockTime = `${part("hour")}:${part("minute")}`;
  // Present only on a 12-hour clock, and appended rather than interpolated so the 24-hour
  // output is byte-identical to what this function produced before the clock was an argument.
  const period = part("dayPeriod");

  return `${part("year")}-${part("month")}-${part("day")} ${clockTime}${period === "" ? "" : ` ${period}`}`;
}

/**
 * `2026-08-17 14:30 Asia/Manila` — the same stamp, carrying its zone.
 *
 * For a reader who has no zone of their own and no shell to state one in: a Jira comment,
 * read by someone who may never have heard of QAMS. The IANA name is used in full rather
 * than an abbreviation, because abbreviations are not unique — `IST` is three different
 * zones and `CST` is four — and a stranger cannot resolve one from context they do not have.
 *
 * ## Why this clock is fixed and not configurable
 *
 * Always 24-hour. The organization zone exists because a Jira comment needs a zone and there
 * is no viewer to ask; that argument does not carry over to the clock, because
 * `14:30 Asia/Manila` is *already* unambiguous to a stranger and `02:30 PM Asia/Manila` is
 * strictly more to parse — in a ticket that may equally be read by a script or pasted into a
 * changelog. So there is no question here for a deployment to answer, and no setting for it
 * to get wrong (ADR-0007).
 */
export function formatInZoneWithName(value: Date, timeZone: string): string {
  return `${formatInZone(value, timeZone, "h23")} ${timeZone}`;
}
