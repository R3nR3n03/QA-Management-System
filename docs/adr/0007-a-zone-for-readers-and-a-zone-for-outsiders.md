# A zone for readers and a zone for outsiders

Status: accepted

Decided and implemented 2026-08-17, and amended the same day to add the hour format — see the
amendment section below.

QAMS holds every timestamp as a UTC instant and renders every one of them as UTC. That stays
true of the record and stops being true of the screen. Two separate zones are introduced:

- an **organization zone**, a deployment-level environment variable, used where QAMS writes
  for an audience it cannot identify — today, the Jira comments;
- a **viewer zone**, a nullable attribute on `User` that each person sets for themselves, used
  for the stamps on their own screens.

They are never one setting. Everything a machine reads — the `/api/v1` responses, the
`dateTime` attribute of a `<time>` element, audit events — stays ISO-8601 UTC and does not
move.

Policy lives in `../data-model.md` and `../api-and-security.md`; this record is only the
engineering reasoning, and where the two disagree those documents are right.

## The business day that does not exist

The obvious design is one zone: the deployment's. It is what almost every application in this
shape does, and a future reader will assume it was rejected by accident. It was not.

The starting question was whether anything in QAMS depends on a **local calendar day**. If
anything did — a "finalized today" queue, a daily throughput count, a report boundary — then a
single authoritative zone would be forced, because a business day cannot be per-viewer without
the same query returning different answers to different people, at which point the number stops
meaning anything.

Nothing does. There is no `gte`/`lte` on a timestamp anywhere in `src/domain/`, no grouping by
day, no date range in any list query, and no "today" filter. The `window` parameter threaded
through every domain service is pagination and not a time window. The one date-shaped value in
reporting, `traceability.ts`'s `asOfUtc`, stamps *when a snapshot was taken* and bounds nothing.
The SOPs agree: `../sops.md` has no daily or weekly cadence, and SOP-06 scopes release readiness
by product, release and environment, never by date.

So the constraint that would have forced a single zone is absent, and inventing a business day
to justify one would be filling a policy gap from general QA practice — which `CLAUDE.md`
forbids outright.

**This is the fact most likely to be lost.** A reader who finds the organization zone will find
it referenced by one caller, governing no query, and reasonably conclude it is dead
configuration left over from something. Deleting it silently changes every Jira comment QAMS
writes into somebody else's project, for readers in another country, in a way nothing inside
QAMS would ever surface. If a calendar-day rule is ever added, it belongs to the organization
zone and to nothing else, and this ADR should be revised rather than rediscovered.

## Why Jira does not follow the viewer

A result comment or a lifecycle comment is written into a project QAMS does not own. Its reader
is a developer or a PM who may not be a QAMS user at all, has no stored preference, and might
not be in this organization. **There is no viewer, so the viewer zone is undefined by
construction** — not merely inconvenient to look up.

That leaves the organization zone or UTC, and the organization zone wins because the comment is
QAMS speaking on behalf of a team that keeps particular hours. The zone is **named in the text**
(`2026-08-17 14:30 Asia/Manila`, never a bare `14:30` and never an abbreviation like `PHT`,
which is not unique). Naming it preserves the property `jira-comment.ts` was already protecting
with a comment of its own: the output does not depend on where the process happens to be
running.

## Why the viewer's zone is stored, not detected

`Intl.DateTimeFormat().resolvedOptions().timeZone` is free, always right, and needs no settings
screen. It was rejected on an architectural constraint: QAMS is server-rendered, and **the
server does not know the browser's zone at render time**. Detection therefore means either a
hydration mismatch on every timestamp React renders, or moving all timestamp rendering
client-side — which would dismantle `format.ts` as the one shared rendering and reintroduce
exactly the screen-to-screen divergence its doc comment exists to prevent.

A stored preference is known server-side at render and survives SSR untouched. It also mirrors
the rule already in force for the effective role: derived server-side from the session, never
submitted by the client.

The column is **nullable**, and null carries meaning. "Never expressed a preference" is
genuinely different from "chose `Asia/Manila`", and only the former follows a deployment that
later changes its organization zone. A backfill would erase that difference permanently, and it
would erase it for everyone at once.

Legal values are checked against `Intl.supportedValuesOf('timeZone')`. A `ControlledValue` row
was rejected: `CLAUDE.md` fixes the catalogues at exactly Priority, Severity and Result, so a
fourth is a policy amendment — spent on a list the platform already maintains and this
organization has no authority over.

## Why an absent zone is legal and a malformed one is fatal

Unset is valid and means UTC, so an untouched deployment renders byte-identically to today and
the only thing that moves it is a deliberate act. `.env.example` already argues this twice:
`JIRA_COMMENT_ON_FINALIZE` is off unless set because "a deployment that upgraded while only ever
asking for transitions must not start writing into its tickets on its own", and this changes the
text of those same comments.

A value that is *present but unrecognised* stops the process at boot, matching `APP_BASE_URL`
and `JIRA_ENCRYPTION_KEY` rather than the fall-back-to-default treatment of `SESSION_TTL_HOURS`
and the rate limits. The repo's own doctrine decides which side this falls on: a typo like
`Asia/Manilla` that quietly degraded to UTC would make every Jira comment read eight hours off,
invisibly, discovered by a stranger long after whoever typed it could connect the two — which is
precisely the bug this whole change exists to remove.

The fallbacks chain and terminate at present behaviour: viewer zone → organization zone → UTC.

## Why machines keep UTC

Localising a machine-readable timestamp **destroys information**. A caller holding an instant can
convert it to any zone; a caller holding `2026-08-17 14:30` cannot recover the instant without
knowing which zone produced it. So `/api/v1` stays ISO-8601 UTC regardless of who asks, and the
`dateTime` attribute keeps carrying the instant while only the text between the tags moves —
which is the entire reason `<time>` is worth using.

Audit events stay UTC for a second reason on top of that one: they are evidentiary and are
correlated against server logs by request ID, and `../business-rules-and-validation.md` states
the UTC obligation directly. That sentence is unchanged by this decision.

## Amendment, 2026-08-17: the clock follows the viewer and never Jira

A second display preference joins the zone: `User.hourFormat`, a nullable `HourFormat` enum
(`H12` / `H24`) deciding whether that person's screens draw `14:30` or `02:30 PM`. It is
recorded here rather than in an ADR of its own because it is the same decision surface — how a
stamp is drawn, and for whom — and because the interesting half of it is a *corollary* of the
reasoning above.

**Jira is fixed at 24-hour, and there is no deployment-level setting at all.** The obvious move
was to mirror the zone: an `ORGANIZATION_HOUR_FORMAT`, the same viewer → organization → default
chain, Jira using the organization's. That was rejected, because the argument that created the
organization zone does not transfer. The zone exists on that surface for a hard reason: a Jira
comment must state *some* zone or the stamp is meaningless, and there is no viewer to ask which.
A clock has no equivalent — `14:30 Asia/Manila` is *already* unambiguous to a stranger, and
`02:30 PM Asia/Manila` is strictly more to parse in a ticket that may equally be read by a
script or pasted into a changelog. So the outside audience has no question here, which means the
deployment has nothing to configure and nothing to get wrong.

The two preferences therefore fall back **differently**, and `viewerStampFormat` is where that
asymmetry lives: the zone chains through the organization's, the clock goes straight from "never
chose" to 24-hour. A reader who expects them to be symmetrical should read this paragraph rather
than "fix" it.

Three smaller consequences:

- **The hour is zero-padded on both clocks.** `02:30 PM`, not `2:30 PM`. These stamps sit in
  list columns, and an unpadded hour moves the colon a character between rows — a ragged edge
  that costs more in scannability than the leading zero costs in noise.
- **The shell states the zone and not the clock.** `02:30 PM` and `14:30` announce which one
  they are simply by being read; a zone does not, which is why only it needs saying once.
- **One service, one audit event, one form.** `changeOwnTimeZone` became
  `changeOwnDisplayPreferences`, because somebody who moves office and prefers a 12-hour clock
  had a single intention and should not save twice or leave two rows in an append-only log
  for it.

## Consequences

- **`formatUtcMinute` becomes a lie and is renamed**, taking the zone as an explicit argument so
  no call site can render without saying which zone it rendered in.
- **Two existing screens come into scope as correctness, not tidying.**
  `admin/imports/[id]/page.tsx` and `jira-connection.tsx` render raw ISO instead of going
  through the shared formatter. Once everything else localises they would be the only UTC stamps
  on screen, sitting beside localised ones and silently disagreeing with them.
- **The viewer's zone is stated once in the shell**, beside "signed in as", rather than on every
  row. A zone repeated on forty rows of an executions list is noise that trains people to stop
  reading it.
- **`/account` widens.** Its `navigation.ts` basis moves from "every role manages only its own
  credential" to include display preferences — recorded the same way the screen itself was, as
  `NOT IN THE MATRIX`, owner-approved and dated. A QA Lead cannot set someone else's zone: a
  zone is a fact about where a person sits and they are its only authority.
- **Setting a zone follows the full mutation convention** — version checked and incremented, and
  an audit event appended. An exception would have cost a policy amendment to
  `../business-rules-and-validation.md` in order to avoid writing one row per person per
  lifetime, and the log is the only thing that can later answer why someone's screens started
  reading differently.
- **Imported historical rows keep a known skew.** `parseHistoryDate` reads a bare `2026-03-04`
  from the seed workbook as midnight UTC. If the author meant midnight in Manila the stored
  instant is eight hours late, and rendering it in a viewer's zone moves it to 08:00 rather than
  correcting it. Accepted and not migrated: the rows are historical, and a migration would be
  guessing at intent nobody recorded.
