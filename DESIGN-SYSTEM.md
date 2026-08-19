# QAMS Design System

**Updated:** 2026-08-19 · **Lives in:** `src/app/globals.css` (tokens + primitives), `src/ui/*` (components)
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
| Form grids | `.form-grid-2`, `.form-grid-4`, `.detail-cols`, `.steps-row` | field grids collapse 4→2→1 at 900/560px; `.detail-cols` stacks under 900px; `.steps-row` aligns the steps editor on the inputs' bottom edge (no pixel offsets in JSX). `.detail-cols` is for a record body plus a **fixed** metadata rail — a screen with no width cap wants an aside that grows and then stops instead, which is `.checks-top` (see "Filling a wide screen") |
| Settings columns | `.settings-cols`, `.settings-main` | a settings form that fills its card: the controls in one column, the `.why` that qualifies them in the next, the submit under both. Sized with `repeat(auto-fit, minmax(min(260px, 100%), 380px))` and **no breakpoint**, because the thing that decides whether there is room is the *card*, which a media query cannot see. **The tracks are capped, not `1fr`** — and that one change is what let `/account` take the width at all. With `1fr` the controls took whatever the card was given, so the only way to stop a 520px `<select>` was to cap the page; capping the control instead states the same rule the right way round, and a card that grows past 380px per track spends the extra on nothing. `min(260px, 100%)` in the lower bound so a card narrower than the minimum shrinks its track instead of overflowing — the account cards are 700px wide beside each other on a desktop and 300px wide beside each other on a laptop, at viewport widths 400px apart. Reach for `.form-grid-2` when the container's width tracks the viewport, and for this when it does not. The submit stays outside the grid so source order remains controls → note → submit at either column count (the consequence is read before the button), since explicit grid placement is the one thing `auto-fit` cannot have |
| Card | `.card` | container radius, `--elev-1`; `padding: 0` variant hosts row lists |
| Page banner | `.page-banner`, `.page-banner-text`, `.page-banner-lede`, `.page-banner-actions` | the header that opens a screen whose **purpose** has to be stated before anyone acts: a medallion, the `<h1>`, one line saying what the screen does, and the screen-level actions on the right. `.page-head` stays the default and most screens keep it — a list's name plus its actions needs no explanation, and a lede stranded above forty rows is a line every reader learns to skip. Reach for this only where the subject is a **process** the reader has to understand to use the screen at all: Automation checks, where what ingestion does *not* do (start no execution, raise no defect, move no figure) is as load-bearing as what it does. The actions slot is for a screen-level control, not a task-level one — the naming contract belongs there because it is the convention an automation team works to, agreed once, while the sample results file belongs in the upload card next to the file it is a specimen of |
| Panel header | `.panel-head`, `.panel-head-text`, `.medallion` | a medallion, the `<h2>`, and one line saying what the panel is for. For a card whose contents are a **task** — the account panels — where a bare heading left the form starting cold; a card that holds rows does not need one, because the rows say what they are. **No state chip here:** a panel's state goes beside the control that changes it (`.row` with the button), where "Connected" and the Disconnect it is about to undo read as one thing — in the header it is decoration, read once and then never again. Where a state has no control to sit beside, the chip takes the position the control would have had, so it does not move between states. The medallion is a 38px tinted disc (52px as `.medallion-lg`) and is always `aria-hidden`: the heading beside it is the name. `.medallion-sq` makes it a rounded square at the same sizes and tones, and the shape is a **rank**, not a decoration: the disc is reserved for a panel's own heading, and the rounded square is everything that is not a panel — a page (`.page-banner`), an action (`.action-row`), an empty state's mark (`.empty-mark`), a drop target (`.dropzone`), a row in a list of facts (`.fact-list`). So a screen's opening mark, a panel's heading, and the marks on the rows inside that panel never read as the same kind of thing. Radius comes off the existing scale rather than being tuned per size. Its tones reuse the chip washes the contrast matrix already holds to 4.5:1, and it is the one place icons exceed the 15–17px rule — it is the first mark on a panel, not a glyph inside a line of text |
| Record screen | `.case-screen`, `.case-body`, `.case-aside`, `.case-pair`, `.review-alt`, `.lifecycle-form` | the shape a record with attributes takes: identity and lifecycle above, then `.detail-cols` with the record in the body column and the attributes it was filed under in the rail. `.case-screen` and `.case-body` each own **one** rhythm — the gap between screen-level bands, and the gap between sections in the column — so nothing inside carries a margin of its own; both zero the bottom margin of anything that has one for ordinary page flow (`.crumbs`, `.stepper`, `.why`). `.case-pair` is the matched pair a card holds side by side (`auto-fit`, no breakpoint — the card decides, and a media query cannot see a card). `.review-alt` is the other half of one decision under a rule **inside the same card**, never a second card: returning a case is approving it taken the other way. `.lifecycle-form` is consequence-then-control, and carries no trailing margin because it renders both as the only thing in a card and as the first of two halves in another |
| Metric panel | `.dash-screen`, `.dash-grid`, `.dash-panel`, `.dash-panel-wide`, `.dash-panel-head`, `.metric-note` | one metric: its name, its **declaration**, then its chart, in a card that tiles with its peers. `business-rules-and-validation.md:56` requires execution and defect metrics to state filters, numerator, denominator and as-of time *before being shown*, so `.metric-note` sits above the chart and is **never** collapsed behind a `<details>` — that would not satisfy "before being shown". It is four labelled facts that wrap, not the one prose sentence it was (`Filters: … . Numerator: … . Denominator: … . As of … .`), because a reader after one part had to read all of it, and at body size the declaration was louder than the figure it qualified; the label takes the darker ink so the eye can land on `Denominator` without reading the rest. No medallion on these panels: the design system reserves one for a card whose contents are a task, and six marks beside six headings would carry nothing the headings do. `.dash-grid` is `repeat(auto-fit, minmax(min(440px, 100%), 1fr))` with no breakpoint — 440px comes from what a bar row needs (`.bar-head` 110px and `.bar-count` 64px are fixed, so a narrower track leaves the bar itself under 200px), and `align-items: start` keeps a three-bar panel from stretching to match a six-bar one beside it. `.dash-panel-wide` spans the row, for the trend: twelve weeks in a 440px track is 30px a week, and a chart of change over time needs the horizontal room to show the change |
| Tiling roster | `.roster`, `.roster-row`, `.roster-who`, `.roster-name`, `.roster-when` | one person, one state, tiled into as many columns as the card has room for. For a list whose row is a **name and one fact about it** — the Jira connection roster. It replaced `<table className="table">`, and `.table` had **no rule anywhere in the stylesheet**, so the roster rendered as a bare browser table: no borders, no header treatment, no padding. A styled table was not the fix either — two columns is not a table (`.data-table`'s own rule is homogeneous data of three or more), and one of those two columns was the same state word repeated down the page. So the state becomes a chip on the person's row and the rows tile: `repeat(auto-fit, minmax(280px, 1fr))`, no breakpoint, because what decides whether there is room for another column is the **card** (`.settings-cols`' rule) — and 280px is where a name, its stamp and a `Not connected` chip still share one row without the chip wrapping. This is how a list spends width the way a table does: a wider screen shows **more** of the roster, not a wider one |
| Hero band | `.hero-panel`, `.hero-body`, `.hero-facts`, `.hero-note`, `.hero-art*` | the card that OPENS a screen: accent left edge, a soft accent-wash gradient, and room for a drawing beside the copy. Only for a panel that **reports a state the reader did not set** (the Jira connection on `/account`) — a card of settings stays a plain `.card`, or every panel is the loudest one. The artwork is `aria-hidden`, carries no information the words do not, reads its state off the band's `data-state` in CSS rather than taking a prop, and is the first thing dropped at 900px. The same component renders `variant="card"` where it sits in a rail rather than opening a screen (`/admin/integrations`, where it is the one panel not about the deployment) — presentation differs, state and copy do not, and the artwork is dropped because it is sized as a share of a full-width band and a 420px rail has no room for it |
| Record row | `.list-row` | hover wash, soft separator, wraps on narrow screens |
| Marked row | `.row-mark`, `.row-main`, `.row-title`, `.row-facts`, `.row-when`, `.row-cta`; `RunMark`/`StateMark`/`OutcomeMark` (`src/ui/row-mark.tsx`) | the four-part shape a record row takes when it has a state and one obvious next action: **mark, record, when, action**. Worn by both lists of executions — My work's queue and its recap, and `/executions` — so the same record cannot read as two shapes in one product. The row needs no class of its own: having a mark IS what makes it this kind of row, so the tighter gap follows from `.list-row:has(> .row-mark)` — one fewer class, and impossible to apply inconsistently. `.row-mark` is `aria-hidden` because the chip beside it carries the word; what it adds is somewhere for the eye to land down a column of near-identical rows, and an x every record starts at. It marks the **loudest axis**, which is the one the row's chips already choose: a finished run by its outcome, an open one by its state. `.row-when` is a slot and not a sentence tail, which is the load-bearing part — anything with a slot of its own leaves `.row-facts`, so that line stays short enough to read. Tones are the chips' own, so a mark and the words beside it can never look like two claims, and nothing here grades anything |
| Action list | `.action-list`, `.action-row`, `.action-row-title`, `.action-row-said`, `.action-row-go` | a list of places a reader can go, each row a medallion + what it is + one line saying when to reach for it. Supersedes the `.btn-sm` + `.hint` pair these started as on `/admin/checks`: that shape made the small control the only target while the sentence explaining it — the longer, more readable half of the row — was inert, and a button on the same baseline as a paragraph reads as a caption for the button rather than a description of somewhere to go. Borderless for the reason `.case-line` records (rows in a list, not standalone controls), so the separator, hover wash and chevron are the affordance; a bordered card each would make two secondary links the loudest thing on the screen. Hover underlines the title as well as tinting it, so the target never depends on colour alone. Sized to a `--sp-5` card, like `.list-row` — the negative inline margin is what lets the wash reach the card's edges so the whole row reads as one target |
| Fact list | `.fact-list` | the handful of facts a reader needs before acting, in the aside beside the thing they are about to do. Each line is a `<strong>` claim plus its consequence, and every one must paraphrase something the system actually does — the same rule `WorkTipCard`'s `basis` enforces, since a line with no basis is advice, which `CLAUDE.md` forbids. Each mark is a `.medallion medallion-sq` — the same 38px rounded square `.action-row` uses, so no new size enters the scale — carrying an icon that **means** the fact beside it. It replaced four identical rings, which marked where a line started and said nothing about which line it was; four facts a reader has to hold before uploading are worth being able to find again by shape. The claim is its own line and the rows are divided by hairlines rather than by a gap, because the aside is a reference a reader returns to and four bold openers are scannable where four paragraphs with a bold first clause are not. **Every mark is the same tone**, deliberately not a tick and never `--pass`: a tick says "good", that token is reserved for what policy grades (principle 4), and a column of green ticks beside an ingest form would read as "these checks passed" on the one screen whose whole subject is checks passing and failing. Nor does each fact get a hue of its own — that is `.stat-tile`'s objection, four colours saying nothing the words do not |
| Drop target | `.dropzone`, `.dropzone-text/-title/-said/-name/-swap`, `[data-over]`, `[data-held]` | where a file is handed over, for a screen whose **whole purpose** is one upload. `/admin/checks` takes the width because "the form is the work" and the form was then the platform's ~200px file button in a card with 900px to spend; the file has almost always just been dragged out of a CI artifacts folder, so dragging it is the gesture to support. **A panel, not a bar:** it began as a 70px row — mark, sentence, done — which is the right shape for a field and the wrong one for a target, and widened to the 1100px an uncapped screen hands it, that row read as a rule drawn across the card rather than as an area to drop something into. It is now a centred block with real height whose copy stays a 52ch column in the middle (`.dropzone-text`), so growing the zone never grows the line length, and whose mark takes `.medallion-lg` because it is the first thing in a panel; `[data-held]` collapses back to a row at the 38px size, since the height exists to invite a drop and there is nothing left to aim at once a file is in hand. A `<label>` wrapping the real `<input type="file">`, which stays in the DOM, stays focusable and stays the thing that submits — nothing is reimplemented, so the keyboard reaches the platform control and `cy.hydrated('input[type="file"]').selectFile(…, { force: true })` still finds it. Its border is `--line-strong` (SC 1.4.11, pinned by `globals.contrast.test.ts`) and dashed, which says "put something here" in the one place where that is the whole instruction; `[data-held]` turns it solid with the name in `--mono` and the size beside it, because a dashed zone still inviting a drop is a lie once it holds a file. **Nothing inside is a `<button>`** — a button in a label inherits the label's activation, so Replace is a `<span>` describing what clicking the zone now does. The mark stays untinted in both states: `--pass` is reserved for what policy grades, and a green mark beside an ingest form would read as "this passed" on the one screen whose subject is checks passing and failing. A size cap may be **reported** here as the deployment's configured value and never as a rule (`src/lib/upload-limits.ts` — the limit is not policy) |
| Record head with a tally | `.check-head`, `.check-file-id`, `.check-stamps` | the band that opens a record whose reader arrives with two questions, where `.run-head` is the same pattern for an execution: "both are questions a reader arrives with, so neither belongs in a rail below the fold". The batch report opened with a bare `<h1>`, one muted stamp line and then a thousand rows, with the unresolved count buried in a `.why` band inside the card. `.check-file-id` is a **file name** as the heading, monospaced — deliberately not `.run-id`, which means a business ID, and a check batch has none (`data-model.md`) |
| Tally as filter | `.tally`, `.tally-slot`, `.tally-n`, `.tally-w`, `.tally-note`, `[data-tone]`, `[data-zero]` | a fixed set of counts where **each count is the filter for the rows it counts** — the number a reader reads is the number they click. Replaced three controls doing one job on the batch report: a `.why` band's "Show them", a lone `.select-filter` beneath it, and nothing tying either to a count. A `<ul>` of real buttons carrying `aria-pressed`, **not a `<dl>`**: `.run-stats` is a definition list because an execution's tally is read-only, and these are controls, so the precedent is `.seg`/`.seg-count` — the chosen slot is **raised out of a shared trough** (to `--surface`) rather than tinted, so the choice survives greyscale. Six values sits at the ~5 ceiling `.seg` states, which is the argument for this tile form over the rail form rather than for a select. Values take their result's ink as reinforcement only (the word beneath names the outcome) and grade nothing — they count what a runner already decided, against no threshold any document defines. A slot counting nothing is `disabled` and keeps its place: its position is what makes the other five findable between batches, and an enabled control that filters to an empty table is a dead end offered on purpose. `.tally-note` is the sentence that qualifies the set, sized on `.run-summary-note`'s rule |
| Check row | `.check-test`, `.check-said`, `.check-said-more`, `.check-run` | a check as a two-line row — the test, and under it what the runner said — shaped like `.action-row-title`/`.action-row-said`. The message was a 160-character clip with the remainder in a `title`, which no keyboard, no touch screen and no printed page can reach, on the one screen whose whole subject is why something failed and where `data-model.md` calls the spec and test name "the only thread from a failed check back to the code behind it"; a long message keeps its head inline and the rest in a real `<details>`. On a test case's panel it also replaced a `<br>` + `.hint` inside `.row-main`, where the message wrapped under the test name at whatever width was left. `.check-run` groups rows under the run that produced them — free, because ingestion stamps one `checkedAt` for a whole file on purpose, so the panel was printing one instant twenty times while never saying six of them were one run — and names the first group **Latest run**, which is the answer to `architecture.md`'s "what did automation last see here?". It names a **run** and not a check: a case checked by two specs in one file has two checks at one instant, so "the most recent check" is decided by nothing, and lifting either one out would present an arbitrary pick as what automation last saw. The batch link belongs to the run, not to every check in it |
| List filter | `FilterToolbar` (`src/ui/toolbar.tsx`), `.list-toolbar` | the one filter toolbar; appears only when a list exceeds 5 rows; Escape clears; filtering is presentation — the server decides what exists |
| Stepper | `Stepper` (`src/ui/stepper.tsx`), `.stepper` | ordered list of lifecycle stages; current step carries `aria-current="step"`, done steps carry sr-only "(complete)" — never color alone. Two variants, identical semantics: `bar` (default) is a thin segmented rail for a screen whose subject is something else; `cards` (`.stepper-cards`) gives each stage a tile with room for an icon and a legible timestamp, for a record whose lifecycle IS the headline (an execution run). A per-step `icon` replaces the dot and is `aria-hidden` — the stage name is in the label |
| Segmented filter | `.seg`, `.seg-count` | a small, fixed set of mutually exclusive views over one list (lifecycle state on the executions list, per-case outcome on a run). Real `<a>`s carrying `aria-current`, never buttons: the view lives in the query string, so each segment is a **place** — linkable, middle-clickable, working before hydration. The selected segment is raised out of a shared trough rather than merely tinted, so the choice survives greyscale. Optional `.seg-count` tally is tabular. Anything longer than ~5 options stays a `.select-filter` |
| Run header | `.run-head`, `.run-summary`, `.run-stats`/`.run-stat`, `.run-id`, `.run-lede` | the execution detail band: stage cards beside the tally. The tally is a `<dl>` — each number is the value **of** the word above it. Graded counts take their result's ink as reinforcement only (the word names the outcome), and they count what policy already graded — never a rate, threshold or judgement (principle 4). `.run-id` is the business ID as the h1, in `--mono` at 24px; `.run-lede` is what the record is, and is deliberately not an `<h2>` so the outline stays intact. **These two are the shared record-head pair, not run-specific** — the test case screen uses the same `.page-head > .cluster` + `.run-id` + chip + `.run-lede` shape, which is the reading `.check-file-id`'s note already relies on when it calls `.run-id` "a business ID". A record's identity is the thing people quote, search and compare, so that is the h1 and the human-readable name is the line under it |
| Covered case row | `.case-item`, `.case-said`, `.case-steps` | a covered case as a record row that opens: head is ID + title + graded outcome, and everything the run recorded (steps, actual result, block reason) folds underneath **on the case it belongs to**. Was a `<section>` + `<h2>` per case with the evidence duplicated in the 340px rail, which put an eleven-case run's results eleven headings from their cases |
| Working case row | `.case-line`, `.case-open`, `.case-open-bad` | the same row as the control that opens its result dialog (`FinalizeForm`). A real `<button>` with `aria-haspopup="dialog"`; borderless like `.list-row` because it is a row in a list, not a standalone control — hover wash, separator and chevron are the affordance. The separator lives on `.case-line` (the `<li>`), not the button: the row is two elements, since a `<details>` cannot nest inside a `<button>`. `.case-open-bad` marks the case owning a server-rejected field so it stays marked once the dialog is dismissed. Superseded `.case-pick` (which stays the bordered-card form) when the finalize flow moved out of the rail |
| Steps disclosure | `StepsDisclosure` (`src/ui/steps-disclosure.tsx`), `.case-steps`, `.case-steps-dialog` | THE way a case's steps are shown inside a run — the read-only covered-case row, the working row, and the result dialog (where it is `open` by default, above the outcome: the task order is read the steps, then say what happened). Takes plain objects, not Prisma rows, so a client component can render it without pulling `@prisma/client` into the browser bundle. A case with no steps says so rather than offering a control that opens onto nothing |
| Run history | `.history-list`, `.history-row` | the append-only grading record in the rail, drawn as a timeline — a dot per entry on a connecting rail, which is what says these are one ordered sequence rather than unrelated rows. Capped in height and scrolled, never truncated behind a "show more" that would undercut the append-only claim |
| Fact grid | `.fact-grid` | two or three short labelled facts about a record, set apart from the prose around them ("Finalized on", "Executed by"). A `<dl>` on the inset surface at body size — attributes, not measurements, so not a `.kpi` |
| Data table | `.data-table` in a `.table-scroll`, `.num`, `.num-none`, `.tight` | for homogeneous ≥3-column data people scan and compare (the import report, the check batch list, the test case list); record rows with a story stay `.list-row`. **The test case list crossed over on the same test the batch list did.** It was three stacked lines per row — ID and state chip, then the title, then `high priority · major severity` — so a Critical/Blocker case read exactly like a Low/Trivial one, fifty records ran a page and a half deep, and a wide screen bought nothing but more empty margin beside three short lines. Five homogeneous fields with two of them appended to each other as a sentence is the failure this component exists to fix. Its trailing `View` button went with the rows: in a three-line block it was the only thing that looked clickable, and in a table the ID and title are the two leftmost columns with a hover wash on the row, so a sixth column going exactly where the title already goes is chrome — and it was `tabIndex={-1}` already, so no keyboard path is lost. Priority and severity stay **words, not chips**: they grade nothing (`business-rules-and-validation.md` defines no threshold on them), and a column of coloured pills would read as a verdict on each case. `.tight` is `width: 1%` plus `nowrap` — the shrink-to-content idiom `.num` already uses, applied to a column that is not a figure; put it on every column but the one that gains from room and that column takes all of a wide screen's slack (`ID`, `State`, `Priority`, `Severity` hug, `Title` grows). **A column has to tell a reader something about THIS row.** The review queue is scoped to one state, so `showState={false}` drops the column that printed `In Review` on every row — the same noise as a chip bag or a chart closing its gaps; `/my-work/drafts` keeps it, because two states means the column names which one. The mirror of that rule adds something: `viewerUserId` marks the rows the reviewer wrote (`.case-mine`, a scaled-down neutral `.state` beside the ID), because the screen's lede stated the rule that an author cannot approve their own case and the list gave no way to see which rows it applied to — a reviewer found out by opening one. Neither is derived inside the component: a page of rows that happen to share a state is not a list scoped to one, and a component has no session. The batch list crossed over when its tallies became a column: as a `.list-row` they were a run-on sentence appended to the timestamp, so a batch reporting failures read exactly like one that did not. **A tally is columns, not one cell of chips.** The batch list's `Recorded` cell built its chips from `Object.entries(counts)` — file order — so the same outcome sat in a different position on every row and a clean run showed two chips where a bad one showed five; the column still could not be scanned, which is the failure that moved it off `.list-row`. The word belongs in the `<th>` (already mono, uppercase, 10.5px — a column label) and the cell is a `.num` figure under it: right-aligned, `tabular-nums`, never wrapped. Count columns are **untoned**, unlike `.run-stat-pass dd`, for two reasons and the second is measured — the heading already names the outcome, so a hue carries nothing the column does not (the objection `.stat-tile` records); and `--pass` on `--accent-wash`, which `tbody tr:hover` paints behind these cells, is 4.44:1, under the floor `globals.contrast.test.ts` holds every other read number to. A zero keeps its slot as `.num-none` (a dash, `aria-hidden`, with the number in `.sr-only` — a screen reader announcing "en dash" down a numeric column is worse than one saying "zero"), on `.week-bar[data-zero]`'s rule that a chart closing its gaps turns a quiet fortnight into activity. Column order is load-bearing where a suite asserts on it: the check batch list puts its tallies **left** of who and when, because the browser suite runs at 1440×900 precisely because a column pushed outside `.table-scroll` is clipped. Column headers are the only `<th>` — the row's own identifying cell stays a `<td>`, because `.data-table th` is styled and stickied for a column heading and would mangle a row header. Sortable headers are real buttons with `aria-sort`; long tables page via the shared `Pager` (pages of 50, client-side only — the earlier binary "show all" reveal is superseded), and a sort change resets to page 1 |
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
| KPI tile | `.kpi` | label / tabular value / hint. Read-only context, which is the whole difference from `.stat-tile` below: a stat tile is a **link into the rows it counts**, and on the dashboard only one of the four figures has a list that shows exactly it (`/executions?state=FINALIZED`). Linking two of four would be an affordance that works sometimes, which is worse than one that never claims to — so the two classes stay two classes rather than being unified into a link that lies on half its instances |
| Stat tile | `.stat-tiles`, `.stat-tile` | the compact rail form of a KPI: value over an icon+word label, two to a row. Each tile is a **link into the rows it counts**, which is what keeps a panel of tallies from being the queue's tab counts printed a second time. Untinted by default — four differently-coloured tiles would be four hues carrying no information; only the states that already carry a tone on the rows take one, so a tile and the runs it counts agree. Values use proportional figures, NOT `.kpi`'s `tabular-nums`: equal-width digits are for numbers that align down a column, and at display size they make `121` read loose. Counts only — principle 4, and `business-rules-and-validation.md:39` defines no percentage, threshold or target to grade one against |
| Side rail | `WorkRail` (`src/ui/work-rail.tsx`), `.work-rail`, `.rail-actions` | a screen-level second column: stat tiles, then shortcuts filtered through `navigation.ts` so a role never sees a link it cannot use. Sticky beside the content, stacked under it below 1180px, and last in source order so a phone gets the work before the summary of it. The screen is uncapped (`.shell-main:has(.work-screen)`), and the rail **grows with it and stops**: `clamp(300px, 22vw, 400px)`, resolving to 300px at every width where the two columns still fit, so nothing below 1364px moves. A fixed 300px beside a 1300px queue is the sliver `.detail-cols`' fixed aside became on `/admin/checks` — a rail is the other half of a composition, not a leftover. `.work-screen-main` owns the gap between the panels in the work column, so neither of them carries a margin |
| Tip card | `WorkTipCard` (`src/ui/work-tip.tsx`), `work-tips.ts`, `.work-tip` | a hint panel that earns its place two ways: the tip is CHOSEN on the server from the state of the list beside it, so it is always about something on screen, and it can be dismissed for good. Every tip carries the `basis` line it paraphrases — a tip with no documented source is advice, which `CLAUDE.md` forbids. Dismissal hides the card, not one tip: contextual tips would otherwise just surface the next one tomorrow |
| Browser preference | `useStoredPref` (`src/ui/stored-pref.ts`) | THE way a UI-only preference persists (nav collapse, theme, dismissed tips). `useSyncExternalStore` over `localStorage` so the server and client snapshots agree and hydration stays clean; reads are try-guarded because Safari private mode throws, and a preference is never worth taking the tree down for. Never for anything the domain owns — it is invisible to the server, unshared between devices, and lost when storage is cleared |
| Bars | `.bar-row/-head/-track/-fill/-count`, `.bar-label` | 10px marks, 4px rounded data end, labels in ink tokens, identity never fill-alone. `.bar-label` is for a value carrying no chip of its own — a QA-Lead-configurable severity, or a word the domain returns — and exists because it was `style={{ fontWeight: 620, fontSize: 13.5 }}` at two call sites, which is how one treatment ends up defined twice and drifts once. `.bar-row` carries no horizontal padding: every chart sits in a padded `.dash-panel` now, where the `--sp-5` it held for a `card-flush` host would be doubled |
| Skeleton | `.skeleton` | shape-of-the-page loading; sweep animation |
| Breadcrumbs | `.crumbs` (`Breadcrumbs`) | detail screens only; current record is text with `aria-current` |
| Empty state | `.empty`, `.empty-mark`, `.empty-title` | two forms, and the difference is whether there is a way forward. Bare `.empty` — one calm sentence — is for a list that came back empty because a **filter matched nothing**: there the sentence IS the whole message, and dressing a dead end up would offer a route that does not exist (see `ListEmpty` for the two causes a paged list must not confuse). The furnished form adds `.empty-mark` (a `.medallion-lg .medallion-sq`) and `.empty-title` for a screen that is empty because nothing has happened **yet**, where the page around it is what fills it — the mark, the fact, the sentence, and the control that acts. `.empty-title` is scoped under `.empty` on purpose: `.empty p` is (0,1,1) and sets both margin and muted ink, so an unscoped title would lose to it and render as another line of body copy |
| Sidebar | `.rail*`, `.nav-link`, `.nav-badge` | see `src/ui/sidebar.tsx`; badges are domain read models. The rail is pinned (`position: sticky`, one viewport tall) and only `.rail-groups` scrolls, so sign-out is reachable without scrolling to the end of the page — as a stretched column it took the height of the tallest content on screen. Group headings stick within their own group while it scrolls. Brand is a lockup: `.rail-mark` (accent tile, the `icon.svg` geometry) + `.rail-word`, which is clipped rather than removed when collapsed so the rail still announces "QAMS". Each `.rail-group` is a `role="group"` named by its heading — as bare `<div>`s the three groups announced as one flat run of links. The search box prints its shortcut (`.rail-kbd`, `⌘ K` or `Ctrl K`) and Ctrl/Cmd+K reaches it from anywhere, expanding a collapsed rail first. Both modifiers are accepted rather than branching on the platform, and the label is read through `useSyncExternalStore` — never an effect that calls `setState`, which `react-hooks/set-state-in-effect` forbids and which the server snapshot makes unnecessary. The shortcut **stands down while focus is in a field someone is typing in**: a nav shortcut must never eat a keystroke aimed at a form, and Ctrl+K is macOS's own kill-line inside a text field. WCAG 2.2 SC 2.1.4 does not reach a shortcut that requires a modifier, so no opt-out is owed; `aria-keyshortcuts` on the input is what makes it discoverable without the printed `<kbd>` |
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
by side in `.acct-grid`, which carries **no breakpoint** and reflows off the column it sits in
(see below for why both of the ones it used to have are gone); and the identity plus the
preferences actually in force sit in a rail beside them. Ordering by what a reader came for
beats ordering by what the page loaded first.

**Filling a wide screen is two decisions, not one.** The test case record screen takes 1440px
with `.shell-main:has(.case-screen)` because its body column is prose. Every other screen here
goes past it, and each for a reason of its own: a table (`/admin/checks`, `/test-cases`), a
queue (`/my-work`, `/executions`), two panes pinned to the viewport (the catalogue), a roster
that tiles (`/admin/integrations`).

`/account` held the cap longest and argued hardest for it — "a form stretched to 1900px is a
worse form, not a fuller one" — and that argument turned out to be **right about the controls
and wrong as a reason to cap the page**. Capping `.settings-cols`' tracks at 380px stops the
`<select>` growing no matter how wide the page gets, which is the same rule stated where it
belongs, and it leaves the width free to be spent on structure. The rule that survives every
screen in this product is the shorter one: **cap the measures, not the page.** Then each panel spends that width on
a second column of its own (`.settings-cols`) rather than on wider controls, because a 660px
`<select>` and a 90-character line of body copy are both harder to use than the 320px versions.
The `.hero-panel` follows the same rule from the other side: `.hero-body` stops at 74ch and the
artwork is sized as a share of the band (`min(420px, 34%)`), so the composition scales instead
of leaving a small drawing in the corner of a large card.

`.checks-screen` takes the width further than any screen but the catalogue: `max-width: none`.
It began at the 1440px opt-in the test case record screen still takes, and 1440 turned out to be
a cap on the one screen whose two largest elements both want every pixel — a nine-column table,
and a drop target that gets easier to hit the bigger it is. Past 1440 that cap left a column of
empty page beside both.

"A form stretched to 1900px is a worse form, not a fuller one" still holds, and the way this
screen keeps it is by **capping the measures rather than the page**. The aside grows with the
screen and then stops, at `clamp(320px, 26vw, 480px)` — `.checks-top` and not `.detail-cols`,
whose fixed 340px is a metadata rail's width and reads as an afterthought beside a 1300px card
rather than as the other half of the composition. The qualifier keeps `.why`'s 52ch and sits on
one line with the submit it qualifies (`.ingest-commit`), packed left rather than
`space-between`, because the dialog-footer convention would put 400px of white between a
sentence and the control it is about — undoing the one thing putting them on a line was for.
The drop target's own copy is a centred 52ch column and the hint under it stops at 74ch. So the
screen fills a monitor of any width and **no line of prose on it grows with the monitor**.

The batch table spans the full width underneath, and literally spends it: nine columns,
because each outcome is its own `.num` column rather than a chip in one shared cell. **Their order is a constraint, not a
preference.** `File`, `Tests` and the five counts come first, then `Ingested by` and
`Started` — the browser suite runs at 1440×900 for the sole reason that a column pushed
outside `.table-scroll` is clipped, Cypress correctly reports it "not visible", and the spec
then fails on the viewport instead of on the product (`docs/testing-and-acceptance.md`
§ "Browser suite"). Keeping the answer a Lead came for to the left of the provenance means a
long file name someone's runner chose cannot push a tally out of the fold. Nine columns measure
about 970px of the ~1150px a 1440px viewport leaves, so nothing clips at the narrowest width
the design targets; the ordering is what keeps that true without anyone re-measuring it.

**The test cases module splits that decision three ways rather than making it once.**
`/test-cases` is uncapped like the catalogue: once the list became a `.data-table` the thing
filling the screen is five columns over fifty rows, and homogeneous data people scan reads
better the more room it has. `/test-cases/[id]` takes the 1440px opt-in — the last screen that
does — and spends it on a second column of its own: the record on the left, the attributes it
was filed under in `.detail-cols`' rail on the right. It keeps the cap where `/account` gave
its up because an objective is **prose**, and prose is the one thing a capped measure inside
the page cannot rescue: an uncapped body column would hand a paragraph 1500px. `/test-cases/new` takes no opt-in at all: it is
one form of four sections, and widening it would only widen the controls. Three screens, three
answers, each following from what is actually on the screen.

That rail replaced one muted run-on line under the `<h1>` — "Authored by Priya Raman · Q3 /
S12 / 2026.4 · staging · High priority · Major severity · version 3" — nine facts a reader had
to parse as a sentence to answer a question as small as "which sprint?". It is `<dt>`/`<dd>`
pairs in `.fact-grid`, grouped under the same headings the create form asks its questions under
("Classification", "Planning"), so the record reads back in the order it was filled in;
"Provenance" is third because it is the one group nobody typed. `.case-pair` then puts the
objective and the expected result side by side for the reason `.settings-cols` exists — the
**card** decides whether there is room, so `auto-fit` and no breakpoint — and `.case-body` owns
one rhythm for the sections in the column, superseding `style={{ marginBottom:
"var(--sp-5)" }}` on seven cards. The steps table is the smaller half of the same fix: two
unlabelled `.row-main`s side by side, where nothing on screen said which half was the
instruction and which was what it should produce. The words belong in the `<th>`s.

A test case also carries a lifecycle, and it takes the `bar` stepper the component doc reserves
for exactly this ("the stage is context on a screen whose subject is something else").
**Retired is not a pending step.** `roles-workflows.md` makes retiring optional — "retiring the
prior revision is optional and must not break historical references" — so a fourth segment
sitting grey beside an Approved case would present an optional end as the expected next one. It
is appended only once the case has been retired, and that state is terminal, so a rail that
grows once never shrinks again. Its words come from `TEST_CASE_STATE_LABEL`, the same map the
chip beside it reads, because four strings restated are four chances to disagree about what
`IN_REVIEW` is called. The rail is capped at 560px: `.stepper li` is `flex: 1 1 120px`, and
across a 1392px screen three segments holding one word each read as three empty bars.

**My work is where a row list meets an uncapped page, and the answer is not the same as a
table's.** `.work-screen` dropped its 1440px cap: it is a QA Tester's front door, the thing
filling it is a queue of runs, and the cap put a column of empty page beside the work rather
than protecting anything. But a row list has diminishing returns past a point in a way a table
does not — the record is on the left, the action on the right, and the space between them is
not information. It is still the right trade (a wrapped timestamp or a two-word title column
costs a reader more than a gap does), and it is the reason the **rail** takes a share of the
width and the row does not: `clamp(300px, 22vw, 400px)`, so four tiles two-up, four shortcuts
and a tip each get another 100px, and nothing below 1364px moves at all. A fixed 300px beside a
1300px queue is the same sliver `.detail-cols`' fixed aside became on `/admin/checks`.

`.work-screen-main` now owns the distance between the queue and its recap, which is the general
rule those screens keep arriving at: **a container owns its rhythm, a panel carries no margin**.
`.work-card` and `.work-done` each had `margin-bottom: var(--sp-6)`, and the last one's was 32px
of empty page under the screen — the same fault `.case-body` fixed for seven cards and
`.case-screen` for a stepper and two bands.

The empty open queue is a **third** empty-state case, and it is the one the `.empty` note did
not have: not "nothing has happened yet" (the deployment may be full of runs) and not "a filter
matched nothing" (there is no filter — this is the whole queue). It is *there is genuinely
nothing here for you, and the next step is somewhere else*, and that is what makes furnishing it
honest: the rule to clear is "dressing a dead end up with a medallion and a call to action offers
a way forward that does not exist", and here the way forward is a real screen. The three
filtered branches beside it keep the bare sentence. An **inbox and not a tick**: `--pass` is what
policy grades, and a green tick on a screen whose rows carry pass/fail marks would read as a
result rather than as an empty queue.

`/my-work/drafts` wears `.cases-screen`, the class `/test-cases` wears. That class names the
**content** — a screen whose body is a `CaseTable` — and not a route, so two screens rendering
the same five-column table cannot end up different widths by accident.

**The executions module splits the width the way the test cases module does, and the LIST side
follows My work rather than `/test-cases`.** `.runs-screen` is uncapped and `.run-screen` stops
at 1440px. The reason the two lists differ is what is in them: `/test-cases` is a
`.data-table`, where width buys columns that line up, and `/executions` is `.list-row`s, where
it buys a stamp that stops wrapping and a title that stops folding into a two-word column. The
smaller win is still worth taking; it is just why the row anchors its right-hand slots to the
card's edge and nothing tries to fill the middle.

The record screen needed the room for a different reason. At 1040px `.run-head` was fitting
four stage cards and a six-value tally into 992px, and `.detail-cols` under it was giving a
filterable, paged list of covered cases about 650px with a 340px aside pressed against it —
the squeeze `/admin/checks` had before it took the width. It stops at 1440 and not at the
viewport because the body column is where a run's evidence is read: a 1500px body would put
340px of aside beside 1100px of half-empty row, and `.case-said` is capped at 68ch either way.
`.run-screen` and `.run-cases` then own their rhythm — five inline `marginBottom`s and a
`style={{ margin: 0, flex: 1 }}` on an `<h2>` went with them.

**The row was the real find.** `/executions` and My work list the same records, and only one of
them had been designed: the queue had a mark, a record, a `when` slot and a CTA, while
`/executions` put covered cases, the outcome breakdown, the tester, the verb-and-stamp of the
last event and the Jira key into **one muted line of five facts** — a sentence, unscannable
down a page of fifty, and the exact run-on that moved the batch and test case lists to tables.
Here the answer is not a table: an execution row is a record with a story and a state machine,
which is what `.list-row` is for, and My work had already settled its shape. So `/executions`
takes that shape, the stamp moves into `.row-when`, and the marks moved out of `work-queue.tsx`
into `src/ui/row-mark.tsx` — a general list must not import from the tester's front door.

That refactor renamed `.work-mark`/`.work-when`/`.work-cta`/`.work-row` to the `.row-*` family
they belong to. `.work-*` was accurate while My work was the only screen with them and became
a lie the moment a second screen wanted the same shape; `.row-main`, `.row-title` and
`.row-facts` were already sitting there naming the same parts. **Name a class for the shape,
not for the screen it was born on** — the same correction `.run-id`/`.run-lede` needed when the
test case screen took the record head, and `.cases-screen` was designed to avoid.
`DefectList` keeps the plain row: a defect status has no mark vocabulary, and inventing five
tones to make two lists rhyme would be decoration.

**`/admin/integrations` is the case where widening a screen would have made it worse, and the
width had to be earned first.** It was three cards stacked down a 1040px column, and two of the
three held almost nothing: a three-value settings grid, and a two-column table of names. Nothing
there gets better at 1900px — a stack like that only widens its empty half. So the width is
spent on structure. The deployment's two panels take the main column, the Lead's own connection
moves to the rail, and the roster tiles (`.roster`), which is what makes more room mean more
list. Then, and only then, `max-width: none`.

Moving that personal panel was an **information-architecture** fix, not a layout one. The screen's
subject is the deployment — does it sync, and who can it sync as — and the Lead's own connection
sat between those two panels, interrupting the question the screen exists to answer with a
personal aside. It is a convenience on this screen ("a Lead looking at this page should not have
to go elsewhere to connect themselves"), so it belongs in the rail with the other things that are
not the subject. `JiraConnectionPanel`'s `card` variant now documents that position, including
why the illustrated `hero` variant would be wrong there: the artwork is sized as a share of a
full-width band, and an illustrated aside would be the loudest thing on a screen about something
else.

Two smaller corrections worth stating because both were **borrowed vocabulary**. The settings
grid was `.cat-stats`, the catalogue's tally of child records — a count of children is not a set
of named values, and borrowing it made three settings read as three figures; it is `.fact-grid`
now, the pattern every other record screen states its attributes with, capped because
`.fact-grid` normally lives in a 340px rail and carries no measure of its own. And the roster's
chip is deliberately **not** `JiraConnectionPanel`'s three-state one: that panel answers "can my
transitions be recorded as me?", which an unconfigured deployment makes `Unavailable`, while a
roster row answers "does this person have a credential stored?", which is true or false whatever
the environment says. Two questions, two chips — and the shared part is the tone rule
(`.state-accent`, never `.state-pass`, because a configured integration is not a QA result).
The roster also shows `connectedAt`, which the domain had been returning and the screen had been
throwing away.

**The review queue completes the `.cases-screen` set**, so all three lists of test cases are
uncapped and a five-column table gets the same room whichever one a reader arrived at. The
interesting part of that screen was not the width, though — it was that **two of its columns
were wrong in opposite directions**. `State` printed `In Review` on every row, because the list
is scoped to that state; and nothing on any row said who wrote it, on the one screen whose own
lede states that an author cannot approve their own case. A reviewer learnt which rows those
were by opening one. Both come out of the same question — *does this column tell a reader
anything about this row* — and the fix costs no query: the session already holds the id.

**`/account` was called the one screen that should not be widened, and that was wrong** — or
rather, it was right about the thing being protected and wrong about how to protect it. The
objection was that width lands on the controls ("a 660px `<select>` and a 90-character line of
body copy are both harder to use than the 320px versions"), which is true, and a page cap is a
very blunt way to stop it: it also forbids every other use of the room. Capping `.settings-cols`'
tracks at 380px stops it at the source, and the screen is then free to take the page like every
other one. Recorded rather than quietly reversed, because the reasoning is the useful part: when
a screen seems to need a narrow page, check whether it needs a narrow **control**.

What the freed width buys is a rail carrying the identity and — the thing this screen never said
— **which display preferences are actually in force, and where each came from**. That is not
decoration: ADR-0007 is explicit that a null zone and a null clock inherit from different places,
because a viewer who has chosen no zone is served by the deployment's own (a Jira comment needs
an organization zone anyway) while the clock has no such middle step and falls straight to the
application default. So the rail reads "The organization's zone" against one and "The application
default" against the other, never the same sentence for both. The rail also settles where the
identity lives, after three homes: a muted run-on sentence, then three values in the header's
corner, and now a panel — because a header corner has room for three short facts and nothing
more, and there was more to say.

The rail appears at 1400px, and that number is arithmetic rather than feel: the two setting cards
need 664px of main column, the rail's floor is 320px, the gap is 24px, and the shell spends 296px
on its sidebar and padding. Below it the rail stacks as the last card. It is deliberately not
gated on each card keeping its own inner second column — that column holds the `.why` note, and
stacking it under the controls is the fallback those forms are written for, not a failure state
worth withholding a rail to avoid.

**The dashboard was the clearest case of all: seven panels stacked in a column, six of them the
same small bar chart.** One chart filled a laptop viewport, so comparing any two meant scrolling
between them — on the one screen whose entire job is comparison. They are peers and are laid out
as peers now (`.dash-grid`), which is also what makes the width worth taking: more room means
**more charts on screen**, not wider charts. Same return a `.data-table` and the integrations
roster give, same reason all three are uncapped.

The order is headline numbers → trend → breakdowns, because that is what a reader descends
through, and the trend leads the grid at full width as the only chart answering
change-over-time rather than magnitude-across-categories. Within the breakdowns, related
subjects are adjacent — the two execution metrics, then the two defect ones, then cases and
requirements — so a two-column layout puts each pair side by side instead of a page apart.

**A policy constraint shaped the metric declaration and is worth stating so nobody "tidies" it
later.** `business-rules-and-validation.md:56` requires the filters, numerator, denominator and
as-of time to be stated *before being shown*. The obvious cleanup — folding four repetitive
lines into a disclosure — is exactly what that forbids. So `.metric-note` stays above every
chart and always visible, and the improvement is in how it reads rather than whether it is
there: four labelled facts at caption size instead of one body-size sentence.

One redundancy is left deliberately and is a **question for the QA Lead, not a design call**:
`dashboardSnapshot()` stamps one `asOfUtc` and copies it into every metric, so the same instant
is printed eight times — once in the lede and once per panel. Whether stating it once for the
snapshot satisfies "each metric must state its as-of time" is a reading of the rule, and the
authority order puts that with the document rather than with this file.

Two further faults on that screen were the ones the rest of this pass had taught us to look for.

The first is the run-on: `For priya@… · Priya Raman. Accounts and roles are managed by the QA
Lead.` — three facts and a rule in one uncapped `.muted` line, with the role chip floating
opposite a sentence that already named it. The rule became the screen's **lede**, and the three
facts moved twice: first to a block in the header's corner, then into the rail above, which is
where they stayed. Splitting the rule out fixed the sentence; only the panel had room for what
the screen was still not saying.

The second is a **breakpoint that made the layout worse before it gave way**. `.acct-grid` went
to one column at 900px, so between 900 and 1180 the two cards were about 290px each — and each
holds a `.settings-cols` needing 260px per track, so both collapsed too and the screen became
four stacked sub-columns of ~240px controls. Raising it to 1180 fixed that, and capping the
control tracks then removed the premise of both numbers: a single 380px control column in a
430px card is a perfectly good card. So `.acct-grid` has **no breakpoint at all** now —
`repeat(auto-fit, minmax(min(320px, 100%), 1fr))`, reflowing off the column it sits in, which is
the only thing that knows whether a second card fits once that column's width depends on
whether the rail is present. The artwork keeps its own 900px query: that is a different squeeze.

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
