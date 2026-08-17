# QAMS Design System

**Updated:** 2026-08-17 · **Lives in:** `src/app/globals.css` (tokens + primitives), `src/ui/*` (components)
**Status:** the implemented system, documented — not a proposal. Outside `docs/` deliberately: visual
treatment is not QA policy (`docs/architecture.md` § "Web interface" records the policy-level UI
decisions; this file records the craft).

## Principles

1. **Semantic color is the loudest channel.** Pass/Fail/Blocked and severity do real work on every
   screen, so the brand accent stays quiet and neutrals are biased cool toward it. The status
   colors mark graded QA results and the terminal outcome of a system operation the product has
   already decided (an import run that FAILED, a staged row that was REJECTED or is held for
   RECONCILIATION_REQUIRED). What they may never do is express a judgement about product quality
   that policy has not defined — no percentage, threshold or ageing target
   (`business-rules-and-validation.md:37-38`). The earlier blanket "nothing else may use them" cost
   more than it bought: a failed import rendered identically to a successful one, so a run that had
   imported nothing could be read as "my workbook imported".
2. **State is never color alone.** Every status ships as a chip: word + stripe + wash. Charts carry
   identity in row labels and chips; fills are reinforcement.
3. **The domain is the gate; the UI is a courtesy.** Hiding/disabling in the UI is presentation.
   Every warning a screen shows ("finalizing can't be undone") precedes a rule the domain enforces.
4. **Nothing is graded that policy doesn't grade.** Dashboards report numbers with their stated
   filters/numerator/denominator/as-of; no red/green judgement exists anywhere
   (`business-rules-and-validation.md:37-38`).
5. **Words come from the docs.** Lifecycle labels use the exact spelling in `roles-workflows.md`
   ("In Review", not "In review").

## Tokens (`:root` in globals.css)

| Group | Tokens | Notes |
|---|---|---|
| Surfaces | `--paper`, `--surface`, `--surface-2` | page, card, inset |
| Lines | `--line`, `--line-soft` | **structure only**: card edges, row separators, axis rules. Decoration a reader may ignore |
| Control edge | `--line-strong` | the boundary of an **interactive** control — input, select, textarea, outlined button, option card, picker frame. A control's fill is `--surface`, the same as the card behind it, so this is the only thing marking where it begins. Held to 3:1 (WCAG 2.2 SC 1.4.11); `--line` is 1.37:1 and must never be used for one |
| Ink | `--ink`, `--ink-2`, `--ink-3` | primary / secondary / muted text |
| Accent | `--accent`, `--accent-2`, `--accent-wash`, `--on-accent` | brand; wash = hover/active fields |
| Status | `--pass`, `--fail`, `--blocked` + `-wash` each | **reserved**: lifecycle results, severity emphasis, danger buttons |
| Status ink | `--on-status` | text placed on a status-colored fill (danger buttons, badges); dark mode flips it to dark ink because the dark status colors are light |
| Radius | `--radius` 10px, `--radius-ctl` 8px, `--radius-sm` 6px | containers / controls / chips |
| Elevation | `--elev-1` resting, `--elev-2` raised | interactive surfaces move one step on hover |
| Motion | `--ease` = 200ms cubic-bezier(0.4,0,0.2,1) | the one motion voice; killed by prefers-reduced-motion |
| Spacing | `--sp-1..7` = 4/8/12/16/24/32/48 | 4/8-point grid |
| Type | `--sans`, `--mono` | mono is reserved for business IDs and references |

**Dark mode** applies two ways and must agree: `@media (prefers-color-scheme: dark)` (unless the
user chose light) and `:root[data-theme=…]` (the in-app toggle, persisted per browser). Any new
token must be defined in all three blocks. The two dark blocks are wrapped in
`DARK-TOKENS-START/END` markers and `src/app/globals.dark-sync.test.ts` fails the build if they
ever disagree.

Both dark blocks also declare `color-scheme: dark` (and `:root` declares `light`). That is what
tells the UA to render the chrome it owns and we cannot style — `<select>` dropdown popups,
scrollbars, date pickers, the default checkbox/radio glyphs — the right way round. Without it the
dark theme repainted every token and still opened white dropdown panels out of a `#0f1116` page.

The stored theme is applied by a small nonced inline script in `src/app/layout.tsx`, not by an
effect in `Sidebar`. `Sidebar` renders only inside `(app)`, so the effect left `/login`, the 404
and the error page light for a user who had chosen dark — the three screens most likely to open a
session. Being inline and synchronous, it also wins the race against first paint, which an effect
cannot; `Sidebar` still owns the toggle.

**Contrast is enforced, not asserted.** `src/app/globals.contrast.test.ts` reads the token values
out of `globals.css` and fails on any pair below its WCAG 2.2 floor — 4.5:1 for body text (3:1
large), 3:1 for a control boundary. It also checks that `--line-strong` is actually wired to every
control rule, because a sound token nothing references proves nothing. Retuning a colour runs the
whole matrix in both themes.

## Typography

| Role | Spec |
|---|---|
| h1 | 26/640, -0.014em tracking, balanced wrap |
| h2 | 19/640 · h3 15/640 |
| Body | 15px/1.55, max 68ch |
| Field label | 13/620 ink-2 · Hint 12.5 ink-3 |
| Chip / button | 13/600 · 14/600 |
| KPI value | 30/660 tabular-nums |
| Business ID | `--mono` 0.92em (`.bid`) — people compare these character by character |

## Components

| Primitive | Class(es) | Rules |
|---|---|---|
| Buttons | `.btn`, `.btn-secondary`, `.btn-ghost`, `.btn-danger`, `.btn-sm`, `.btn-icon` | one radius (`--radius-ctl`); hover = elevation, active = 1px press; loading = disabled + verb ("Saving…"); danger only for destructive commits (retire, deactivate); `.btn-sm` for row-level actions; `.btn-icon` for a label carrying a glyph — `.btn` is `inline-block`, which leaves icon and word a pixel or two apart on the text baseline |
| Icon button | `.icon-btn` | icon-only control outside the rail (modal close, toast dismiss); always carries `aria-label`; `.rail-icon-btn` stays rail-only |
| Layout utilities | `.row`, `.cluster`, `.stack`, `.page-head`, `.row-main`, `.row-title`, `.card-flush`, `.sr-only` | the recurring compositions, named once — pages must not re-declare these as inline styles; `.page-head` is the one page-header pattern (h1 grows, actions on the baseline). A detail screen may put a `.cluster` in place of the h1 — the business ID plus the chips that qualify it — and it takes the room the h1 would |
| Form grids | `.form-grid-2`, `.form-grid-4`, `.detail-cols`, `.steps-row` | field grids collapse 4→2→1 at 900/560px; `.detail-cols` stacks under 900px; `.steps-row` aligns the steps editor on the inputs' bottom edge (no pixel offsets in JSX) |
| Settings columns | `.settings-cols`, `.settings-main` | a settings form that fills its card: the controls in one column, the `.why` that qualifies them in the next, the submit under both. Sized with `repeat(auto-fit, minmax(260px, 1fr))` and **no breakpoint**, because the thing that decides whether there is room is the *card*, which a media query cannot see — the account cards are 700px wide beside each other on a desktop and 300px wide beside each other on a laptop, at viewport widths 400px apart. Reach for `.form-grid-2` when the container's width tracks the viewport, and for this when it does not. The submit stays outside the grid so source order remains controls → note → submit at either column count (the consequence is read before the button), since explicit grid placement is the one thing `auto-fit` cannot have |
| Card | `.card` | container radius, `--elev-1`; `padding: 0` variant hosts row lists |
| Panel header | `.panel-head`, `.panel-head-text`, `.medallion` | a medallion, the `<h2>`, and one line saying what the panel is for. For a card whose contents are a **task** — the account panels — where a bare heading left the form starting cold; a card that holds rows does not need one, because the rows say what they are. **No state chip here:** a panel's state goes beside the control that changes it (`.row` with the button), where "Connected" and the Disconnect it is about to undo read as one thing — in the header it is decoration, read once and then never again. Where a state has no control to sit beside, the chip takes the position the control would have had, so it does not move between states. The medallion is a 38px tinted disc (52px as `.medallion-lg`) and is always `aria-hidden`: the heading beside it is the name. Its tones reuse the chip washes the contrast matrix already holds to 4.5:1, and it is the one place icons exceed the 15–17px rule — it is the first mark on a panel, not a glyph inside a line of text |
| Hero band | `.hero-panel`, `.hero-body`, `.hero-facts`, `.hero-note`, `.hero-art*` | the card that OPENS a screen: accent left edge, a soft accent-wash gradient, and room for a drawing beside the copy. Only for a panel that **reports a state the reader did not set** (the Jira connection on `/account`) — a card of settings stays a plain `.card`, or every panel is the loudest one. The artwork is `aria-hidden`, carries no information the words do not, reads its state off the band's `data-state` in CSS rather than taking a prop, and is the first thing dropped at 900px. The same component renders `variant="card"` where it sits in a stack of peers (`/admin/integrations`) — presentation differs, state and copy do not |
| Record row | `.list-row` | hover wash, soft separator, wraps on narrow screens |
| List filter | `FilterToolbar` (`src/ui/toolbar.tsx`), `.list-toolbar` | the one filter toolbar; appears only when a list exceeds 5 rows; Escape clears; filtering is presentation — the server decides what exists |
| Stepper | `Stepper` (`src/ui/stepper.tsx`), `.stepper` | ordered list of lifecycle stages; current step carries `aria-current="step"`, done steps carry sr-only "(complete)" — never color alone. Two variants, identical semantics: `bar` (default) is a thin segmented rail for a screen whose subject is something else; `cards` (`.stepper-cards`) gives each stage a tile with room for an icon and a legible timestamp, for a record whose lifecycle IS the headline (an execution run). A per-step `icon` replaces the dot and is `aria-hidden` — the stage name is in the label |
| Segmented filter | `.seg`, `.seg-count` | a small, fixed set of mutually exclusive views over one list (lifecycle state on the executions list, per-case outcome on a run). Real `<a>`s carrying `aria-current`, never buttons: the view lives in the query string, so each segment is a **place** — linkable, middle-clickable, working before hydration. The selected segment is raised out of a shared trough rather than merely tinted, so the choice survives greyscale. Optional `.seg-count` tally is tabular. Anything longer than ~5 options stays a `.select-filter` |
| Run header | `.run-head`, `.run-summary`, `.run-stats`/`.run-stat`, `.run-id`, `.run-lede` | the execution detail band: stage cards beside the tally. The tally is a `<dl>` — each number is the value **of** the word above it. Graded counts take their result's ink as reinforcement only (the word names the outcome), and they count what policy already graded — never a rate, threshold or judgement (principle 4). `.run-id` is the business ID as the h1, in `--mono` at 24px; `.run-lede` is what the run covers, and is deliberately not an `<h2>` so the outline stays intact |
| Covered case row | `.case-item`, `.case-said`, `.case-steps` | a covered case as a record row that opens: head is ID + title + graded outcome, and everything the run recorded (steps, actual result, block reason) folds underneath **on the case it belongs to**. Was a `<section>` + `<h2>` per case with the evidence duplicated in the 340px rail, which put an eleven-case run's results eleven headings from their cases |
| Working case row | `.case-line`, `.case-open`, `.case-open-bad` | the same row as the control that opens its result dialog (`FinalizeForm`). A real `<button>` with `aria-haspopup="dialog"`; borderless like `.list-row` because it is a row in a list, not a standalone control — hover wash, separator and chevron are the affordance. The separator lives on `.case-line` (the `<li>`), not the button: the row is two elements, since a `<details>` cannot nest inside a `<button>`. `.case-open-bad` marks the case owning a server-rejected field so it stays marked once the dialog is dismissed. Superseded `.case-pick` (which stays the bordered-card form) when the finalize flow moved out of the rail |
| Steps disclosure | `StepsDisclosure` (`src/ui/steps-disclosure.tsx`), `.case-steps`, `.case-steps-dialog` | THE way a case's steps are shown inside a run — the read-only covered-case row, the working row, and the result dialog (where it is `open` by default, above the outcome: the task order is read the steps, then say what happened). Takes plain objects, not Prisma rows, so a client component can render it without pulling `@prisma/client` into the browser bundle. A case with no steps says so rather than offering a control that opens onto nothing |
| Run history | `.history-list`, `.history-row` | the append-only grading record in the rail, drawn as a timeline — a dot per entry on a connecting rail, which is what says these are one ordered sequence rather than unrelated rows. Capped in height and scrolled, never truncated behind a "show more" that would undercut the append-only claim |
| Fact grid | `.fact-grid` | two or three short labelled facts about a record, set apart from the prose around them ("Finalized on", "Executed by"). A `<dl>` on the inset surface at body size — attributes, not measurements, so not a `.kpi` |
| Data table | `.data-table` in a `.table-scroll` | for homogeneous ≥3-column data people scan and compare (import report); record rows with a story stay `.list-row`. Sortable headers are real buttons with `aria-sort`; long tables page via the shared `Pager` (pages of 50, client-side only — the earlier binary "show all" reveal is superseded), and a sort change resets to page 1 |
| Pager | `Pager` (`src/ui/pager.tsx`) | THE canonical list pagination: pages of 50 (`PAGE_SIZE` in `src/ui/paging.ts`), **server-side**. `total` is the database's `COUNT` and the rows on screen are the only ones fetched, so turning a page is a navigation — real `<a href>`s, middle-clickable, working before hydration. Page and filter live in the query string (`src/ui/list-params.ts`), which is what lets a server component read them; `hrefWith` carries the rest of the string along so paging one list on a four-list screen does not disturb the other three. "Showing X–Y of N", numbered jumps elided in the middle, Prev/Next. Renders nothing until a list passes one page (the >50 sibling of FilterToolbar's >5 rule). Rows-per-page (opt in with `sizeOptions`) is the one part that is NOT a link — see `PageSizeSelect` below |
| Rows per page | `PageSizeSelect` (`src/ui/page-size-select.tsx`), `.page-size`, `.select-sm` | one `<select>` inside `Pager`, replacing the button-per-size row it shipped with: three controls for one setting, three tab stops, and a row that grew with every option anyone might add. A select states the current value closed and costs one stop. It is a client island, so this control alone needs hydration — the same trade `UrlSelectFilter` already makes, and deliberately confined to the size: page numbers and Prev/Next stay real links, so navigating a list never depends on JavaScript. Changing size drops the page key (page 7 of 50s is not page 7 of 100s) and the default size clears the key rather than writing `size=50` |
| Local pager | `LocalPager` (`src/ui/local-pager.tsx`) | The in-memory exception, for a list that cannot be re-fetched because it is one column: the import-run report, whose rows come out of a single `ImportRun.reportJson`. Reach for `Pager` by default — this is not an alternative to it |
| List empty state | `ListEmpty` (`src/ui/list-empty.tsx`) | A paged list renders zero rows for two unrelated reasons and must not confuse them: the filters matched nothing (caller's sentence), or the page is past the end (`total > 0`). Every list used to infer it from the filter params alone, so an overshooting offset reported the wrong cause — `Nothing matches “”.` with empty quotes — above a pager honestly saying "Showing 1–50 of 60". The out-of-range branch carries the only way out, since Prev/Next are computed from the clamped page and point back into the same empty view |
| Record list | `.row-list` + `.list-row` | Record rows are a real `<ul>`/`<li>`. As sibling `<div>`s a screen reader announced a run of generic containers with no "list, 50 items", no item-to-item navigation and no end. `.row-list` only takes back the bullets and indent, so nothing moves visually |
| Chips | `.state` + tone classes | word + stripe + wash; survives greyscale; `.state-accent` is the informational tone for non-lifecycle statuses (import outcomes, "Active") — the Pass/Fail/Blocked tones stay reserved for what policy grades |
| Notice | `.notice`, `.notice-advisory` | failures red; POLICY_NOT_DEFINED and successes calm; `FormNotice` renders both |
| Inline warning | `.why`, `.why-icon` | a blocked or irreversible action carries its reason inline, never in a tooltip. `.why-icon` adds the glyph that says which kind of note it is; the icon is `aria-hidden` and the sentence still names the consequence, and the text keeps its own block so a second line does not wrap under the icon |
| Form section | `.form-section` fieldset | long forms group into named steps |
| Fields | `.field`, `.field-bad` | focus ring = accent wash 3px; error = red border + copy naming the field. Two shapes, one label treatment (`.field > span` and `.field > label > span`): most fields ARE the `<label>`, but a field hosting a second control cannot be — a `<button>` inside a `<label>` inherits the label's activation behaviour, so every press would also press the field. Those are a `<div class="field">` with an explicit `<label for>` inside |
| Field affix | `.field-affix`, `.field-affix-btn` | a control living inside an input's own right edge — today the reveal on a password field. Overlaid rather than placed beside it, so the field keeps its width and the two read as one control; the input reserves the room, or a long value slides under the button. Transparent fill, because a painted one would be a pale rectangle inside a field that turns red when rejected. `aria-pressed` carries the state and `aria-label` names the field it reveals — an icon is not a name, and three stacked password boxes need to say which one |
| Password confirmation | `.pw-match` | whether two masked entries agree, said as they are typed. **Never red**: a mismatch halfway through the second entry is an unfinished field, not a mistake, and the real rejection arrives from the server in the form's own notice. Silent until there is something to compare, icon alongside the tone, `aria-live="polite"`. The server re-checks the same thing — the live check is JavaScript and the submit is not |
| Setting preview | `.setting-preview` | a live echo of the control above it: what the choice actually produces, in the words the product will use. For a setting whose stored value is not its effect (`Asia/Manila` + `H12` is not `2026-08-17 02:30 PM`). Rendered through the same formatter the rest of the product uses, from the instant the page was served — a specimen of the FORMAT, deliberately not a live clock that would slowly become a wrong statement of the time |
| KPI tile | `.kpi` | label / tabular value / hint |
| Stat tile | `.stat-tiles`, `.stat-tile` | the compact rail form of a KPI: value over an icon+word label, two to a row. Each tile is a **link into the rows it counts**, which is what keeps a panel of tallies from being the queue's tab counts printed a second time. Untinted by default — four differently-coloured tiles would be four hues carrying no information; only the states that already carry a tone on the rows take one, so a tile and the runs it counts agree. Values use proportional figures, NOT `.kpi`'s `tabular-nums`: equal-width digits are for numbers that align down a column, and at display size they make `121` read loose. Counts only — principle 4, and `business-rules-and-validation.md:39` defines no percentage, threshold or target to grade one against |
| Side rail | `WorkRail` (`src/ui/work-rail.tsx`), `.work-rail`, `.rail-actions` | a screen-level second column: stat tiles, then shortcuts filtered through `navigation.ts` so a role never sees a link it cannot use. Sticky beside the content, stacked under it below 1180px, and last in source order so a phone gets the work before the summary of it. The screen opts into the width with `.shell-main:has(.work-screen)`, the same escape hatch the catalogue explorer uses |
| Tip card | `WorkTipCard` (`src/ui/work-tip.tsx`), `work-tips.ts`, `.work-tip` | a hint panel that earns its place two ways: the tip is CHOSEN on the server from the state of the list beside it, so it is always about something on screen, and it can be dismissed for good. Every tip carries the `basis` line it paraphrases — a tip with no documented source is advice, which `CLAUDE.md` forbids. Dismissal hides the card, not one tip: contextual tips would otherwise just surface the next one tomorrow |
| Browser preference | `useStoredPref` (`src/ui/stored-pref.ts`) | THE way a UI-only preference persists (nav collapse, theme, dismissed tips). `useSyncExternalStore` over `localStorage` so the server and client snapshots agree and hydration stays clean; reads are try-guarded because Safari private mode throws, and a preference is never worth taking the tree down for. Never for anything the domain owns — it is invisible to the server, unshared between devices, and lost when storage is cleared |
| Bars | `.bar-row/-head/-track/-fill/-count` | 10px marks, 4px rounded data end, labels in ink tokens, identity never fill-alone |
| Skeleton | `.skeleton` | shape-of-the-page loading; sweep animation |
| Breadcrumbs | `.crumbs` (`Breadcrumbs`) | detail screens only; current record is text with `aria-current` |
| Empty state | `.empty` | one calm sentence + the action that fills it |
| Sidebar | `.rail*`, `.nav-link`, `.nav-badge` | see `src/ui/sidebar.tsx`; badges are domain read models. The rail is pinned (`position: sticky`, one viewport tall) and only `.rail-groups` scrolls, so sign-out is reachable without scrolling to the end of the page — as a stretched column it took the height of the tallest content on screen. Group headings stick within their own group while it scrolls. Brand is a lockup: `.rail-mark` (accent tile, the `icon.svg` geometry) + `.rail-word`, which is clipped rather than removed when collapsed so the rail still announces "QAMS". Each `.rail-group` is a `role="group"` named by its heading — as bare `<div>`s the three groups announced as one flat run of links |
| Modal | `Modal` (`src/ui/modal.tsx`), `.modal*` | native `<dialog>` (focus trap, Escape, inert page, focus return are the platform's); sizes sm/md/lg; sticky head/foot, scrollable body; full-sheet under 560px; backdrop click closes only when `closeOnBackdrop` (entry forms: no — typed input outlives a stray click). **The element is authoritative:** every dismissal goes through `el.close()` and the native `close` event is the only path to `onClose`, so a handler cannot fire twice. State is reconciled after every render, not only when `open` flips — with `[open]` as the dependency a browser-initiated close against a handler that did not clear `open` desynced the two permanently and the dialog became unopenable. The body mounts **only while open**, so an abandoned attempt does not come back with its typed value and its stale red notice (note: that resets the form, not a `useActionState` living in the parent — put the form in a child if the action state must reset too). Closed on unmount, before React detaches the node, or focus never returns to the trigger. Initial focus goes to `[data-autofocus]`; a consumer's `autoFocus` is inert here, because the dialog is `display: none` when React commits |
| Confirm dialog | `ConfirmDialog` | warning icon + consequence + the named record + Cancel; the committing control is a caller-supplied server-action form, and the buttons live in the real `.modal-foot` so they stay put instead of scrolling away. `notice` is where the committing action's own rejection goes — rendered on the page instead, it sat behind the backdrop, so a refused confirm looked like a button that did nothing. Used where one click removes availability (deactivate person, deactivate value). A confirm may stack over an open edit modal: both live in the native top layer, which gives focus and Escape to the topmost and returns them outward — allowed, and nothing else may stack deeper |
| Toast | `ToastProvider`/`useToast` (`src/ui/toast.tsx`), `.toast*` | SUCCESSES ONLY — fires when a modal closes itself and takes its inline notice with it. Failures always stay inline (`FormNotice`) naming the field. Polite live region, 4s auto-dismiss that pauses on hover/focus, an explicit dismiss button, no other actions |

**A form may own the record's whole layout.** `FinalizeForm` renders `.detail-cols` itself rather
than sitting in the page's aside: recording results IS the work on an In Progress run, and the one
`<form>` cannot be split across columns the page owns. The wide column is the working list of
covered cases, the rail is the commit panel (count, progress, consequence, submit). Before this the
same cases were listed twice — read-only across the main column, and again as the only actionable
copy in a 340px rail. Reach for this inversion only when the form IS the screen's purpose; every
other detail-screen action stays inline in the rail.

**A half-finished run is held in the browser, not in `useState`.** Because there is no partial
finalize, a per-case result cannot be written to the server before the whole run is submitted — so
there is nowhere on the server for a draft to live, and holding it only in component state meant a
reload (or a trip to another module and back) silently discarded everything already recorded.
`FinalizeForm` keeps the draft in `sessionStorage`, keyed by execution and stamped with the run's
`version` so a run that moved underneath the draft discards it. Read through
`useSyncExternalStore` with a `getServerSnapshot` of "no draft": there is no `useState` mirror and
therefore no effect reconciling two copies, which is what keeps a `setState` out of an effect body.
The snapshot is the raw string, not the parsed object — a parse per call would hand React a new
identity every time and never settle. An in-memory copy backs the store so a browser that refuses
storage can still record. A restored draft announces itself ("Picked up where you left off"), and
the rail states the boundary plainly: it survives a reload, not a closed tab. Tab-scoped on
purpose — a shared browser must not retain someone's un-submitted evidence.

**A filter narrows what is shown, never what is submitted.** `FinalizeForm`'s case search filters
the rendered rows while the hidden inputs still iterate the full covered set — the server has to see
every case to reject a partial finalize (`business-rules-and-validation.md:28`). Counts and progress
likewise speak for the run, not the filtered view. Pinned by a test.

**A screen of settings lays its settings out as peers.** `/account` holds three panels — the Jira
connection, the display preferences, the password — and as a single 480px column of stacked `<h2>`
+ card it put "Change password", the reason most people open the screen, below the fold under a
form about timestamps. The band that reports a state leads; the two that offer a setting sit side
by side in `.acct-grid` and collapse to one column at 900px. Ordering by what a reader came for
beats ordering by what the page loaded first.

**Filling a wide screen is two decisions, not one.** `/account` takes the width with
`.shell-main:has(.acct-screen)` at 1440px — the same escape hatch and the same number My work
uses; the catalogue's `max-width: none` is for two scroll panes pinned to the viewport, and a
form stretched to 1900px is a worse form, not a fuller one. Then each panel spends that width on
a second column of its own (`.settings-cols`) rather than on wider controls, because a 660px
`<select>` and a 90-character line of body copy are both harder to use than the 320px versions.
The `.hero-panel` follows the same rule from the other side: `.hero-body` stops at 74ch and the
artwork is sized as a share of the band (`min(420px, 34%)`), so the composition scales instead
of leaving a small drawing in the corner of a large card.

**Modal vs. page rule:** a create/edit flow lives in a modal when the hosting screen already
has everything the form needs (catalogue add/edit, add person, edit person, add value); it stays
a page when the form is long enough to have sections (new test case) or needs its own reference
data fetch (new defect, plan execution). Detail-screen lifecycle actions (approve, retire,
transition, reassign, finalize) stay inline on the record — they are the record's story, not a
data-entry interruption.

Component modules: `sidebar.tsx`, `case-table.tsx`, `record-list.tsx`, `list-empty.tsx`,
`chips.tsx`, `notice.tsx`, `breadcrumbs.tsx`, `toolbar.tsx` (`FilterToolbar` controlled,
`UrlFilterToolbar`/`UrlSelectFilter` query-string backed), `pager.tsx`/`local-pager.tsx`/
`page-size-select.tsx`/`paging.ts`/`list-params.ts` (list pagination and its query string),
`stepper.tsx`, `modal.tsx`, `toast.tsx`, `form.ts` (field-error accessibility helpers),
`action.ts` (FormState contract), `navigation.ts` (the ratified screen inventory),
`stored-pref.ts` (browser-local UI preferences), `work-queue.tsx`/`work-rail.tsx`/
`work-tip.tsx`/`work-tips.ts` (the My work screen), `format.ts` (the timestamp and outcome
wordings two or more screens must agree on).

**A filter inside a form must swallow Enter.** `FilterToolbar` sits within `PlanForm`'s `<form>`,
where implicit submission would fire the real submit button — creating the execution and
redirecting away from a keystroke meant to narrow a list. Both toolbars `preventDefault()` on
Enter; any future in-form filter must too.

**A rejected GROUP marks the section, not the fields in it.** `fieldClass`/`bad()` return the
`.field` classes and belong on a `<label>`. On a container they tint every control inside —
rejecting the execution planner's case selection turned the unrelated product filter red. Use
`.form-section-bad` (or `outcome-set-bad`) and put `aria-invalid`/`aria-describedby` on the
control that was actually rejected.

**Inline styles:** a page may inline a style only when it is data-driven (a bar's `width: pct%`)
or a genuine single-property one-off (an odd margin). Recurring compositions — headers, rows,
identity lines, grids — must use the layout utilities above; re-declaring them inline is drift.

## Icons

`lucide-react`, 15–17px, `strokeWidth` ~1.9, always `aria-hidden` with adjacent text carrying the
meaning. Icon-per-screen map lives in `sidebar.tsx`, keyed by href so `navigation.ts` stays pure.

The one exception is `.medallion`, where the icon is the first mark on a panel rather than a glyph
inside a line of text: 19px in the 38px disc, 22px in the 52px `.medallion-lg`. Nothing else scales
up — an icon that has to be bigger to be understood is doing work the label should be doing.

## Interaction rules

- Transitions: 200ms, one curve, on background/border/shadow/width — never on layout-shifting
  properties except the rail width. `prefers-reduced-motion` collapses everything.
- Every mutation renders its outcome inline via `FormNotice` — failures name the field
  (`.field-bad`), internal errors show a log-correlatable reference, successes are calm.
- Destructive/irreversible actions state consequences in a `.why` before the button, and the
  button is `.btn-danger` when the action removes availability (retire, deactivate).
- Keyboard: skip-link to `#main`, `:focus-visible` rings everywhere, search fields clear on Escape,
  `aria-expanded`/`aria-current` carry widget state.

## Accessibility checklist for new screens

1. Page starts at `h1`; sections use `h2` in order.
2. Every input inside a `label.field`; errors set `.field-bad` *and* name the field in copy.
3. A failed field also carries `aria-invalid` and `aria-describedby` pointing at the form's
   `FormNotice` — use `fieldClass`/`fieldProps`/`noticeId` from `src/ui/form.ts` with a
   module-level `FORM_ID` slug, so the association survives refactors.
4. Fields are required by default; the exceptions say so — append "(optional)" to the label of
   any control without `required`. Never mark conditionally-required fields optional (e.g. the
   block reason, the finalize-defect fieldset) — their copy explains the condition instead.
5. State chips, never bare color; icons `aria-hidden` beside text.
6. Lists reachable and operable by keyboard only; row actions are real links/buttons.
7. Works in both themes (check the toggle, not just OS preference).
8. Charts: identity via label/chip; the metric statement renders with the numbers, and a
   `.sr-only` sentence summarizes the series for readers who don't get the bars.
9. Anything that disappears on its own can be paused: toasts pause on hover/focus and carry a
   dismiss button.
10. A row action's accessible name identifies its RECORD. Fifty links reading "View" are
    unusable in a screen reader's link list — `aria-label={\`View ${businessId}\`}`, and the row
    title carries the same href as `.row-link` so the pointer target is the widest thing in the
    row. The trailing button then leaves the tab order (`tabIndex={-1}`), or 50 rows become 100
    tab stops to reach 50 places.
11. A skeleton announces with TEXT, not `aria-label`. A live region announces its content; a name
    is not content, so a region of text-free placeholders announced nothing at all. `.sr-only`
    sentence inside, `aria-hidden` on the shapes.
12. An empty state names a next step THIS role can take. The test-case list told a QA Tester to
    create a draft (authors only) and import the workbook (Lead only), with neither control on
    screen for them.
