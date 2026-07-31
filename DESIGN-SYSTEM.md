# QAMS Design System

**Updated:** 2026-08-01 · **Lives in:** `src/app/globals.css` (tokens + primitives), `src/ui/*` (components)
**Status:** the implemented system, documented — not a proposal. Outside `docs/` deliberately: visual
treatment is not QA policy (`docs/architecture.md` § "Web interface" records the policy-level UI
decisions; this file records the craft).

## Principles

1. **Semantic color is the loudest channel.** Pass/Fail/Blocked and severity do real work on every
   screen, so the brand accent stays quiet and neutrals are biased cool toward it. Nothing else may
   use the status colors.
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
| Lines | `--line`, `--line-soft` | borders, row separators |
| Ink | `--ink`, `--ink-2`, `--ink-3` | primary / secondary / muted text |
| Accent | `--accent`, `--accent-2`, `--accent-wash`, `--on-accent` | brand; wash = hover/active fields |
| Status | `--pass`, `--fail`, `--blocked` + `-wash` each | **reserved**: lifecycle results, severity emphasis, danger buttons |
| Radius | `--radius` 10px, `--radius-ctl` 8px, `--radius-sm` 6px | containers / controls / chips |
| Elevation | `--elev-1` resting, `--elev-2` raised | interactive surfaces move one step on hover |
| Motion | `--ease` = 200ms cubic-bezier(0.4,0,0.2,1) | the one motion voice; killed by prefers-reduced-motion |
| Spacing | `--sp-1..7` = 4/8/12/16/24/32/48 | 4/8-point grid |
| Type | `--sans`, `--mono` | mono is reserved for business IDs and references |

**Dark mode** applies two ways and must agree: `@media (prefers-color-scheme: dark)` (unless the
user chose light) and `:root[data-theme=…]` (the in-app toggle, persisted per browser). Any new
token must be defined in all three blocks.

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
| Buttons | `.btn`, `.btn-secondary`, `.btn-ghost`, `.btn-danger` | one radius (`--radius-ctl`); hover = elevation, active = 1px press; loading = disabled + verb ("Saving…"); danger only for destructive commits (retire, deactivate) |
| Card | `.card` | container radius, `--elev-1`; `padding: 0` variant hosts row lists |
| Record row | `.list-row` | hover wash, soft separator, wraps on narrow screens |
| List filter | `.list-toolbar` | appears only when a list exceeds 5 rows; Escape clears; filtering is presentation — the server decides what exists |
| Chips | `.state` + tone classes | word + stripe + wash; survives greyscale |
| Notice | `.notice`, `.notice-advisory` | failures red; POLICY_NOT_DEFINED and successes calm; `FormNotice` renders both |
| Inline warning | `.why` | a blocked or irreversible action carries its reason inline, never in a tooltip |
| Form section | `.form-section` fieldset | long forms group into named steps |
| Fields | `.field`, `.field-bad` | focus ring = accent wash 3px; error = red border + copy naming the field |
| KPI tile | `.kpi` | label / tabular value / hint |
| Bars | `.bar-row/-head/-track/-fill/-count` | 10px marks, 4px rounded data end, labels in ink tokens, identity never fill-alone |
| Skeleton | `.skeleton` | shape-of-the-page loading; sweep animation |
| Breadcrumbs | `.crumbs` (`Breadcrumbs`) | detail screens only; current record is text with `aria-current` |
| Empty state | `.empty` | one calm sentence + the action that fills it |
| Sidebar | `.rail*`, `.nav-link`, `.nav-badge` | see `src/ui/sidebar.tsx`; badges are domain read models |

Component modules: `sidebar.tsx`, `case-table.tsx`, `record-list.tsx`, `chips.tsx`, `notice.tsx`,
`breadcrumbs.tsx`, `action.ts` (FormState contract), `navigation.ts` (the ratified screen inventory).

## Icons

`lucide-react`, 15–17px, `strokeWidth` ~1.9, always `aria-hidden` with adjacent text carrying the
meaning. Icon-per-screen map lives in `sidebar.tsx`, keyed by href so `navigation.ts` stays pure.

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
3. State chips, never bare color; icons `aria-hidden` beside text.
4. Lists reachable and operable by keyboard only; row actions are real links/buttons.
5. Works in both themes (check the toggle, not just OS preference).
6. Charts: identity via label/chip; the metric statement renders with the numbers.
