# Changelog

Every release of QAMS, newest first. One entry per version, added in the same commit as the
version bump — see `CLAUDE.md` § "Releases" for the procedure.

Entries describe what changed for **a person using the system**, not which files moved. Policy
lives in `docs/`; this file records when a policy took effect, never what it says. The release
commit is named so a reader can go from a line here to the diff behind it.

---

## 1.6.1 — 2026-08-17

Release commit `2d272e4` · branch `1.6.1` · tag `v1.6.1`

**My account, laid out as the three peers it holds.** The screen was a single 480px column of
stacked heading + card, which put "Change password" — the reason most people open it — below the
fold under a form about timestamps. The Jira band now leads, because it is the only panel
reporting a state the reader did not set; the two settings sit side by side and collapse to one
column at 900px.

- **Password confirmation.** A second entry, checked as it is typed and again on submit. The live
  check is JavaScript and the submit is not, so a browser without it can no longer set a mistyped
  password — which is invisible until the next sign-in. The indicator is never red: a half-typed
  confirmation is unfinished, not wrong. Agreement between two inputs is a fact about the form,
  not the credential, so the check stays out of the domain service.
- **Reveal buttons** inside each password field, and the minimum length read from the module that
  enforces it rather than restated in copy.
- **Time-zone picker grouped by region,** each zone labelled with the offset it is on at render
  time, plus a live specimen of what the zone and clock choice actually produces — rendered
  through the same formatter the rest of the product uses.

No policy changed; nothing under `docs/` moved.

## 1.6.0 — 2026-08-17

Release commit `40af43b` · branch `1.6.0` · tag `v1.6.0`

- **Jira defect sync (ADR-0006).** Raising a defect creates a bug in its product's Jira project,
  comments on it at every lifecycle transition, and transitions it to Done at closure. A
  `qams-<business ID>` label makes a retried create adopt the issue an earlier attempt made
  instead of duplicating it.
- **Time zones and clocks (ADR-0007).** Stored instants stay UTC and every machine-readable
  surface repeats them as UTC. Presentation splits into an organization zone for readers outside
  QAMS, and each person's own viewer zone and 12/24-hour clock set on `/account`.

## 1.5.0 — 2026-08-12

Release commit `87f71f2` · branch `1.5.0` · tag `v1.5.0` (tagged retroactively 2026-08-17)

- **A run is named by what it checks.** `purpose`, required, at most 120 characters, not unique,
  settable only while Planned — and the workbook may state it on import.
- **The plan picker groups by feature.**
- **Jira:** a finalized run reports its outcome as a result comment on the issue it carries, on
  every finalize whatever it derived (ADR-0004).
- **Fix:** a later run transitions its issue again, and a declined transition is recorded rather
  than swallowed (ADR-0005).

## 1.4.0 — 2026-08-11

Release commit `a073682` · branch `1.4.0` · tag `v1.4.0`

- **Catalogue:** system-generated business IDs for all four levels, and requirement authoring
  opened to QA Engineers (ratified 2026-08-10).
- **Catalogue explorer:** the four tables became a two-pane frame — hierarchy tree with search and
  keyboard navigation, detail panel beside it — with requirements as the fourth level, and
  performance work to hold a large catalogue.
- **Jira execution sync (ADR-0004, approved this release):** per-user connect flow, credential
  primitives, the transport that transitions an issue, retry with a give-up rule, and the issue
  key shown on the executions a run is testing.
- **My work:** Jira issue keys on rows, work overview rail, contextual tips.
- **Fixes:** search-param navigations commit in a production build; a production build without TLS
  keeps its session cookie; expanding a catalogue branch is separate from selecting it;
  `ListEmpty` no longer nests block content inside a `<p>`.

## 1.3.0 — 2026-08-07

Release commit `586b8f5` · branch `1.3.0` · tag `v1.3.0`

- **The QA Lead can reset another person's password.**
- **Fix:** the viewer lands on the result of a screen mutation instead of a stale list.

## 1.2.0 — 2026-08-07

Release commit `7ea9762` · branch `1.2.0` · no tag

- **My work became an actual work queue** rather than a flat list, filterable by product and
  feature and refreshing in place.
- **The executions detail screen was reworked,** and a half-finished run is no longer lost.
- **Fixes:** the result summary counts the run you are actually working; a stray space no longer
  makes every reconciliation row unresolvable.

## 1.1.0 — 2026-08-06

Release commit `f63bb32` · branch `1.1.0` (points at `bbc247c`, see note) · tag `v1.1.0`

- **Filter the plan-execution picker by requirement.**
- **Filter test cases, executions and the plan-execution picker by feature.**

Not in this release: the executions detail-screen rework and the QA Lead password reset — both
still unmerged at the time of the cut, and both shipped in 1.2.0 and 1.3.0.

## 1.0.1 — 2026-08-06

Release commit `8bdf12a` · branch `1.0.1` · no tag

- **Fix:** import reconciliation, left broken by a stale Prisma client.
- **Fix:** a placeholder `DATABASE_URL` so the CI gates can generate the Prisma client.

## 1.0.0 — 2026-08-04

Release commit `1b8c15c` · branch `1.0.0` · no tag

The first release: the whole system as `docs/` specifies it.

- **API and domain.** `/api/v1` over thin route handlers, domain services owning every business
  rule, RBAC derived server-side from the session, optimistic concurrency on every mutable entity,
  and an append-only audit log.
- **Web interface.** A screen for every capability in the role matrix, built on a design system of
  tokens and primitives (`DESIGN-SYSTEM.md`).
- **Workbook import.** The Excel seed source imported through the validated import service, with
  reconciliation of controlled values — never a live authority.
- **Production readiness.** Rate limiting, security headers, CSRF, revocable sessions, an atomic
  version check, database constraint violations mapped to the documented error contract, and the
  acceptance suite automated against a real PostgreSQL database.

---

## Notes on this history

Back-filled on 2026-08-17 from the release branches and tags, which are the only record of what
each version contained — the repository had no changelog before 1.6.1.

Two inconsistencies in the history are recorded rather than tidied away, because the refs are
already published:

- **`1.1.0` and `1.5.0`:** the branch and the tag point at different commits. Everywhere else the
  bump commit, the branch and the tag are one commit. The tag is the more reliable of the two —
  it is on the bump commit in both cases.
- **`1.0.0`, `1.0.1` and `1.2.0` have branches but no tag.** Tagging became consistent from 1.3.0
  onward, and `v1.5.0` was added retroactively on 2026-08-17.

Dates are the author date of the release commit, not the date a tag was added.
