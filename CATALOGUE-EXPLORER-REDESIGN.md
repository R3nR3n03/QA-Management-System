# Catalogue Explorer — redesign proposal

**Branch:** `feat/catalogue-explorer` · **Screen:** `/catalogue` · **Status:** proposal, not built
**Scope:** presentation only. No policy, no lifecycle, no RBAC change.

`docs/` specifies no visual treatment, so nothing here is policy. Where the redesign would
touch something the documents *do* own — the data model, the QA-Lead gate — it is called out
as **[needs a decision]** rather than assumed.

---

## 0. Seven corrections to the brief

The brief was written from a screenshot. Reading the code changes seven things. Taking them
in order because several of them change the design, not just the wording.

**1. There are four stacked tables, not three.** `src/app/(app)/catalogue/page.tsx` renders
Products, Modules, Features **and Requirements**, each with its own pager and its own page key
(`?products=2&modules=3&features=1&requirements=4`). This makes the case for the redesign
stronger, not weaker: the fourth table is 100% orphaned rows — a requirement statement with a
feature ID beside it and no way to see which module or product that feature belongs to.

**2. This project does not use Tailwind.** The UI is a hand-rolled token system:
`src/app/globals.css` (2,532 lines) plus `DESIGN-SYSTEM.md`, consumed as semantic classes
(`.card`, `.list-row`, `.state`, `.bid`). Adding Tailwind for one screen would give the app two
styling systems and two sources of truth for colour. **Section 6 delivers the class structure in
the existing idiom**, with a Tailwind→token mapping so the brief's intent is traceable.

**3. The requested palette is a different product's palette.** The brief asks for `#0B1220`
surface / `#3B82F6` primary. The app's dark theme is `--paper: #0f1116`, `--surface: #171a21`,
`--accent: #93a6dc`. The brief also says *"keep the existing dark theme identity"* — those two
instructions contradict each other, and the constraint wins. Two further reasons:

- **The app is not dark-only.** `globals.css` ships light tokens as the default, dark via
  `@media (prefers-color-scheme: dark)` **and** an explicit `[data-theme]` toggle in the rail.
  A screen hard-coded to `#0B1220` would be the one broken page in light mode.
- **`#3B82F6` as primary would break the semantic colour contract.** `DESIGN-SYSTEM.md` and
  the `globals.css` header both state the accent is deliberately *quiet* so that Pass/Fail/
  Blocked and severity stay the loud channel. A saturated blue primary competes with the marks
  a QA reader actually grades on.

Section 5 maps every requested colour to the token that does its job.

**4. `16px` base radius fights the existing scale.** `globals.css:69` defines one radius scale,
three steps: containers `10px`, controls `8px`, chips `6px`. The redesign uses it unchanged.

**5. A module has no Status and no Owner.** The brief's module header asks for Version, Status
and Owner. In `prisma/schema.prisma`:

| Field | Product | Module | Feature | Requirement |
|---|---|---|---|---|
| `versionTag` (business version) | ✅ | ❌ | ❌ | ❌ |
| `status` (Active/Inactive) | ✅ | ❌ | ❌ | ❌ |
| owner | ❌ | ❌ | ❌ | ❌ |
| `version` (optimistic-lock int) | ✅ | ✅ | ✅ | ✅ |
| `updatedAt` / `updatedBy` | ✅ | ✅ | ✅ | ✅ |

So the module header shows **inherited** product version and status (labelled as inherited, in
the breadcrumb line), the module's own **record version**, and **Last updated** from `updatedAt`.
"Owner" is rendered as **Last updated by**, resolved from `updatedBy` through the user lookup.

> **[needs a decision]** A real `owner` field on Module is a data-model change. It would need
> `docs/data-model.md`, a migration, acceptance scenarios in `docs/testing-and-acceptance.md`,
> and the cross-references in `docs/skills/qa-management-system/SKILL.md`. Out of scope here.

**6. Search reverses a deliberate decision.** `src/domain/catalogue.ts:38-42` says, in a
comment: *"The catalogue lists take paging but no filter: the screen offers no search box, and
inventing one would be UI policy nobody asked for."* The brief now asks for one. That is the QA
Lead asking, so the box is in — **and that comment must be rewritten in the same commit**, or
the next reader finds code contradicting its own rationale.

**7. There is already a left rail.** `.shell` puts a 248px sticky navigation rail (collapsible
to 76px) to the left of every screen. A second 280px panel next to it is two rails, and the
brief's layout would read as "which one is the nav?" Section 1 resolves this: the explorer is
visually a *panel inside the content card*, not a rail — different surface, different border
treatment, its own header. It never looks like navigation chrome.

One more constraint that shapes everything: **`.shell-main` is capped at `max-width: 1040px`**
(`globals.css:2440`). Minus `--sp-6` padding both sides that is 976px of usable width. A 28/72
split gives a 273px explorer and a 667px detail panel — survivable, but the feature table would
be cramped. **The catalogue screen must opt out of the cap** (section 6, `.shell-main:has(.cat)`).

---

## 1. Information architecture

### The hierarchy, and where each level lives

```
Product         PROD001     → tree node (level 1)     · detail: modules + rollup
└── Module      MOD001      → tree node (level 2)     · detail: features + rollup
    └── Feature FEAT001     → tree node (level 3)     · detail: requirements
        └── Requirement REQ001  → tree node (level 4) · detail: the statement. LEAF.
```

> **Reversed during delivery (QA Lead, on review of commit 3).** This section originally
> argued that requirements should *not* be tree nodes: highest cardinality, and a statement
> is a sentence rather than a name, so fifty of them under every feature would reintroduce
> the scrolling the explorer exists to remove. The QA Lead wanted the fourth level. The
> objection was real, so it is answered by two rules rather than waved away:
>
> 1. **Browsing loads one feature's requirements at a time.** The fetch already followed
>    what was open; that now extends one level deeper. At most one feature's worth is ever
>    in the tree, whatever the catalogue's size.
> 2. **Searching shows only requirements that themselves matched.** The downward sweep
>    stops at features — a matched feature shows *closed*, with its count, rather than
>    unfolding everything it owns. Without this, searching a common word would empty the
>    largest table in the catalogue into a 300px column.
>
> Statements still truncate in the tree and are read in full in the detail panel, which is
> what the panel is for.

Either way this fixes the brief's worst symptom: the orphaned Requirements table disappears,
and every requirement is now reachable only *through* its feature — which is the relationship
the screen is supposed to teach.

### Selection state lives in the URL

Everything on this screen is a **place**, not component state:

```
/catalogue                                  → no selection (overview)
/catalogue?sel=p:PROD001                    → product selected
/catalogue?sel=m:MOD001                     → module selected
/catalogue?sel=f:FEAT001                    → feature selected
/catalogue?sel=r:REQ001                     → requirement selected (leaf)
/catalogue?sel=f:FEAT001&q=login            → …filtered
/catalogue?sel=f:FEAT001&req=2              → …requirement list, page 2
```

`r:` for requirements, not `q:` — `q` is the search needle, and two meanings for one letter
in the same URL is a trap someone eventually falls into.

Four reasons this is not negotiable in this codebase:

1. **Server actions land back on the URL they were submitted from.** `actions.ts` ends every
   mutation in `refreshScreen("/catalogue")`, which returns the viewer to the submitting URL
   (see `src/ui/action.ts`, and the `fix/screens-stale-after-mutation` commit). If selection
   were React state, adding a feature would drop you back to "no selection".
2. **It is linkable.** "Look at MOD004" becomes a URL a QA Lead can paste.
3. **Back works.** Browser Back walks the selection history for free.
4. **It works before hydration**, which is how every other list on this screen already works.

Business IDs in the URL rather than UUIDs: they are unique (`@unique` on all four models),
already the human-facing identifier, and readable in a pasted link.

### Which data the server fetches, per selection

| Selection | Tree | Detail panel |
|---|---|---|
| none | products + module counts | overview: 4 stat cards |
| product | + that product's modules | module rows (code, name, feature count, updated) |
| module | + that module's features | feature rows (code, name, requirement count, updated) |
| feature | + that feature's requirements | requirement rows (code, statement, updated) — paged |
| requirement | + siblings, requirement marked | the statement. No child list — it is the leaf. |

**Only the open branch loads children, at every level.** A catalogue with 40 products and 900
features fetches 40 rows plus one branch per level, not 900. This is the lazy-loading
requirement, satisfied by the server component rather than by client fetching — and it is what
makes the requirement level affordable.

Selecting a requirement offers **another requirement under the same feature**, not a child:
nothing hangs off a requirement, and a sibling is what someone writing requirements wants next.

---

## 2. Wireframe

### Desktop, module selected (≥1100px)

```
┌ app rail (248px, existing) ┬──────────────────── catalogue screen ─────────────────────────┐
│                            │                                                               │
│  QAMS                      │  Catalogue                                    [+ Add feature] │  ← sticky
│                            │  Product → Module → Feature → Requirement                     │    header
│  MY WORK                   │  ┌────────┐┌────────┐┌────────┐┌────────┐                     │
│   My work            3     │  │PRODUCTS││ MODULES││FEATURES││  REQS  │                     │
│   My drafts                │  │   4    ││   18   ││   62   ││  241   │                     │
│   Review queue       7     │  └────────┘└────────┘└────────┘└────────┘                     │
│   My account               │ ─────────────────────────────────────────────────────────────  │
│                            │ ┌─ explorer (28%) ────────┐┌─ detail (72%) ───────────────────┐│
│  RECORDS                   │ │ 🔍 Search catalogue  ⌘K ││ Payments / MOD004                ││ ← sticky
│   Test cases               │ ├─────────────────────────┤│                                  ││
│   Executions               │ │ ▾ 📦 PROD001         6  ││ Checkout                         ││
│   Defects                  │ │     Retail Banking      ││ MOD004 · rec. v3 · 12 features   ││
│   Traceability             │ │   ▸ 📁 MOD003        4  ││ · 48 requirements                ││
│   Dashboard                │ │       Onboarding        ││                                  ││
│                            │ │ ▾ 📁 MOD004         12  ││ Inherited  Retail Banking v2.1   ││
│  ADMINISTRATION            │ │ ●     Checkout          ││            ● Active              ││
│ ▸ Catalogue                │ │     ○ FEAT011           ││ Updated    2026-08-05 14:22 UTC  ││
│   Controlled values        │ │        Card capture  8  ││            by R. Panes           ││
│   People                   │ │     ○ FEAT012           ││                        [Edit ✎]  ││
│   Workbook imports         │ │        3-D Secure    5  ││ ───────────────────────────────  ││
│   Release readiness        │ │   ▸ 📁 MOD005        2  ││ FEATURES (12)      🔍 filter…    ││
│                            │ │       Statements        ││ ┌──────────────────────────────┐ ││
│  ───────────────           │ │ ▸ 📦 PROD002         5  ││ │FEAT011  Card capture         │ ││
│  Renmark Panes             │ │     Wealth              ││ │         8 reqs · 2d ago  ✎ ⋯│ ││
│  QA Lead                   │ │ ▸ 📦 PROD003         7  ││ ├──────────────────────────────┤ ││
│  ☾ Theme    Sign out       │ │     Insurance           ││ │FEAT012  3-D Secure           │ ││
│                            │ │                         ││ │         5 reqs · 6d ago  ✎ ⋯│ ││
│                            │ │ ── independent scroll ──││ └──────────────────────────────┘ ││
│                            │ └─────────────────────────┘└──── independent scroll ──────────┘│
└────────────────────────────┴───────────────────────────────────────────────────────────────┘
   ● selected   ▾ open   ▸ closed   ○ feature (leaf-ish)   right-aligned number = child count
```

### Desktop, nothing selected

The detail panel is not blank — it is the overview that used to require scrolling four tables:

```
┌─ explorer ──────────────┐┌─ detail ────────────────────────────────────────┐
│ 🔍 Search catalogue  ⌘K ││                                                 │
│ ▸ 📦 PROD001         6  ││          ┌───────────────────────┐              │
│ ▸ 📦 PROD002         5  ││          │  🗂  (folder-tree)     │              │
│ ▸ 📦 PROD003         7  ││          └───────────────────────┘              │
│ ▸ 📦 PROD004         0  ││                                                 │
│                         ││          Pick something to see it               │
│                         ││                                                 │
│                         ││   Choose a product, module or feature on the    │
│                         ││   left. 4 products · 18 modules · 62 features   │
│                         ││   · 241 requirements.                           │
│                         ││                                                 │
│                         ││   RECENTLY UPDATED                              │
│                         ││   MOD004  Checkout            2026-08-05        │
│                         ││   FEAT011 Card capture        2026-08-04        │
│                         ││   PROD002 Wealth              2026-08-01        │
│                         ││              [+ New product]                    │
└─────────────────────────┘└─────────────────────────────────────────────────┘
```

### Tablet (760–1099px) — explorer collapses to a toggle

```
┌───────────────────────────────────────────────────────┐
│ Catalogue                              [+ Add feature]│
│ [☰ Browse]  Payments / MOD004 / Checkout              │  ← breadcrumb replaces the tree
│ ─────────────────────────────────────────────────────  │
│ Checkout                                              │
│ MOD004 · rec. v3 · 12 features · 48 requirements      │
│ …feature list, full width…                            │
└───────────────────────────────────────────────────────┘
```

### Mobile (<760px) — explorer is a slide-over drawer

The app rail already becomes a top bar under 760px (`globals.css:2445`), so the explorer
must not also be a column. `[☰ Browse]` opens a `<dialog>` drawer from the left; picking a node
closes it and navigates. The detail panel is the whole screen. The 4 stat cards drop to a
single wrapped line of text to protect the fold.

---

## 3. UX rationale

**Why master-detail and not an accordion, a data grid, or nested tables.**

| Considered | Rejected because |
|---|---|
| Nested accordion (product → module → feature, all inline) | Same vertical scroll, just indented. A 40-product catalogue fully expanded is worse than today. |
| One flat data grid with Product/Module/Feature columns | Kills the hierarchy — the thing the brief says users cannot see. Repeats "Retail Banking" 62 times. |
| Tabs (Products \| Modules \| Features \| Requirements) | Cheap to build, but keeps the four tables and *hides* three of them. The relationship gets worse, not better. |
| **Master-detail tree** | The hierarchy is a *structure*, and a tree is the only widget whose shape is the structure. Depth is visible without scrolling; only the open branch pays a rendering cost. |

**Why counts are on the tree row.** "How big is this module?" is asked before "what's in it".
A right-aligned count answers it without a click, and a `0` is the strongest possible signal
of an incomplete catalogue — today that requires reading three tables and cross-matching IDs.

**Why one contextual CTA instead of four Add buttons.** Four buttons means the reader must
decide *which* before deciding *what*. With a selection, the system already knows the parent.
It also removes the worst part of the current forms: the parent `<select>` in `ChildForm`
listing every module in the catalogue with no scoping. When you add a feature to MOD004, the
module is not a question.

**Why the detail panel is the child list rather than a form.** The panel answers "what is in
this?", which is the question a selection asks. Editing stays in the existing modal
(`CatalogueEditForms.tsx`) — it already carries the hidden `id` + `version` pair that makes
`VERSION_CONFLICT` surface instead of a silent overwrite. That mechanism is untouched.

**What is preserved, exactly.** All eight server actions in `actions.ts`, both modal
components, the optimistic-lock version pairs, `refreshScreen` behaviour, the QA-Lead
`notFound()` gate, pager semantics for the one list that still needs paging (requirements),
and every business-ID and immutability rule. **No domain service signature changes.** Only
additive read functions (section 4).

---

## 4. Component hierarchy

### Server / client boundary

The rule this codebase follows: **server components fetch and render; client components exist
only where there is genuine interactivity.** The tree needs keyboard handling and open/closed
state, so it is a client island; everything else stays server-rendered.

```
src/app/(app)/catalogue/
│
├── page.tsx                        ⬛ server  — session gate, parse ?sel/?q, fetch, compose
│   │
│   ├── <CatalogueHeader>           ⬛ server  — title, lede, 4 stat cards, contextual CTA slot
│   │   └── <ContextualCreate>      ⬜ client  — the ONE Add button; picks form by selection
│   │       └── <Modal> …existing CatalogueForms, given a locked parent
│   │
│   ├── <CatalogueExplorer>         ⬜ client  — search box + tree; roving tabindex; ⌘K
│   │   ├── <TreeSearch>            ⬜ client  — wraps existing UrlFilterToolbar (paramKey="q")
│   │   └── <TreeNode> (recursive)  ⬜ client  — <a role="treeitem"> + chevron + icon + count
│   │
│   └── <DetailPanel>               ⬛ server  — switches on selection kind
│       ├── <OverviewPanel>         ⬛ server  — no selection: stats + recently updated
│       ├── <RecordHeader>          ⬛ server  — breadcrumb, title, ID, facts, Edit
│       │   └── <Editable*Row>      ⬜ client  — EXISTING, reused verbatim
│       ├── <ChildList>             ⬛ server  — module / feature / requirement rows
│       │   └── <ChildRow>          ⬛ server  — code · name · count badge · updated · ✎ ⋯
│       ├── <Pager>                 ⬛ server  — EXISTING, requirements only
│       └── <CatalogueEmpty>        ⬛ server  — five polished empty states (section 8)
│
├── CatalogueForms.tsx              ⬜ client  — EXISTING + `lockedParent` prop
├── CatalogueEditForms.tsx          ⬜ client  — EXISTING, unchanged
├── actions.ts                      ⬛ server  — EXISTING, unchanged
└── selection.ts                    ◻︎ pure    — parse/serialise ?sel; unit-testable
```

`selection.ts` is a pure module with no `next/*` import, matching `src/ui/navigation.ts` and
`src/ui/list-params.ts`. It gets a `selection.test.ts` — the repo tests its pure UI modules.

### Domain additions — `src/domain/catalogue.ts`

Additive only. Route handlers and server actions keep calling exactly one service.

```ts
/** Tree spine: every product, plus the open branch's children, each with a child count. */
export async function listCatalogueTree(options: {
  q?: string;
  openProductId?: string;
  openModuleId?: string;
}): Promise<CatalogueTree>

/** One record with its parent chain and its children's counts, for the detail header. */
export async function getProductDetail(businessId: string)
export async function getModuleDetail(businessId: string)
export async function getFeatureDetail(businessId: string)

/** The four totals for the stat cards — counts only, no rows. */
export async function catalogueTotals()
```

Counts come from `prisma.module.groupBy({ by: ['productId'], _count: true })` — one grouped
query per level, three total, assembled in memory. Not `_count` on a per-row include, which is
a correlated subquery per row.

**Search semantics.** `q` matches `businessId` OR `name`/`statement`, case-insensitive, at every
level, and a match **pulls its ancestors into the tree** so a matched feature is still shown
under its module and product. Implemented as: match features/modules/products, collect the
ancestor ID set, filter the tree to that set, auto-expand it. The count badge then shows
*matching* children, and the panel says so ("3 of 12 features match").

**Indexes.** `@@index([productId])`, `@@index([moduleId])`, `@@index([featureId])` already exist
and cover the grouped counts. An `ILIKE '%q%'` scan is unindexed — fine at catalogue scale
(hundreds of rows), and if it ever isn't, a `pg_trgm` GIN index is the fix. Noted, not built.

### Data flow, one selection

```
URL ?sel=m:MOD004&q=
  → page.tsx: requireSession() → QA_LEAD or notFound()
  → parseSelection("m:MOD004")            (selection.ts, pure)
  → Promise.all([ catalogueTotals(),
                  listCatalogueTree({ openProductId, openModuleId }),
                  getModuleDetail("MOD004") ])
  → <CatalogueExplorer tree={…} selected="m:MOD004" />   client island, hydrates
  → <DetailPanel kind="module" record={…} children={features} />   pure server render
```

Mutation round trip is unchanged: `ContextualCreate` → existing `createFeatureAction` →
`createFeature` domain service (RBAC, business-ID format, duplicate check, audit, transaction)
→ `revalidatePath("/catalogue")` → `refreshScreen` → same URL, same selection, tree redrawn
with the new child and the incremented count.

---

## 5. Design system — the brief's palette, mapped

Every requested colour keeps its **job**; only the hex changes, to the token that already does
that job in both themes.

| Brief | Hex asked for | Token used | Light | Dark | Why |
|---|---|---|---|---|---|
| Background | `#0B1220` | `--paper` | `#f5f6f9` | `#0f1116` | Page ground, both themes |
| Surface | `#111827` | `--surface` | `#ffffff` | `#171a21` | Cards, detail panel |
| Elevated | `#1F2937` | `--surface-2` | `#edeff4` | `#1e222b` | Explorer panel, stat card wells |
| Border | `#374151` | `--line` / `--line-soft` | `#d8dce6` / `#e6e9f0` | `#2c313d` / `#242935` | Structure vs. hairline |
| Primary | `#3B82F6` | `--accent` | `#3a4a7a` | `#93a6dc` | Deliberately quiet — see §0.3 |
| Success | `#22C55E` | `--pass` | `#2c7857` | `#62b98d` | Verified ≥4.5:1 on its wash |
| Warning | `#F59E0B` | `--blocked` | `#8f6416` | `#d8a94e` | Same |
| Danger | `#EF4444` | `--fail` | `#b3392f` | `#e08076` | Same |
| Text | `#F9FAFB` | `--ink` | `#171a21` | `#e6e9f0` | |
| Secondary text | `#9CA3AF` | `--ink-3` | `#646a77` | `#868d9c` | Tuned to clear 4.5:1 on `--accent-wash`, which is exactly the hovered tree row |
| Radius 16px | — | `--radius` `10px` | | | One scale already exists (§0.4) |
| Transitions 150–250ms | — | `--ease` `200ms cubic-bezier(.4,0,.2,1)` | | | Already in range. Nothing to change. |
| Focus rings | — | `:focus-visible { outline: 2px solid var(--accent); offset 2px }` | | | Global, already applied |
| Soft shadows | — | `--elev-1` / `--elev-2` | | | Interactive surfaces move one step on hover |

**Three tokens the explorer needs that do not exist yet.** Added to `:root` and both dark
blocks, keeping the `DARK-TOKENS-START/END` markers intact:

```css
--tree-indent: 18px;   /* one level of tree indentation */
--tree-row-h: 34px;    /* tree row height — 3 levels visible without scroll at 900px */
--explorer-w: 300px;   /* explorer column, before the % clamp */
```

**Components reused as-is, not rebuilt:** `.card` / `.card-flush`, `.list-row`, `.list-toolbar`
(the search field — it already has debounce, Escape-to-clear, and a busy state), `.crumbs`
(`Breadcrumbs`), `.state` (status chip), `.bid` (mono business ID), `.kpi` / `.kpi-grid` (stat
cards), `.empty`, `Modal`, `useToast`, `Pager`, `.skeleton`.

**New components:** the tree (`.cat-tree`), the count badge (`.cat-count`), the two-panel
frame (`.cat`), the child row (`.cat-child`), and the illustrated empty state (`.empty-rich`).
Six new blocks, roughly 200 lines of CSS. Everything else is composition.

---

## 6. CSS class structure

Written in the project's idiom: semantic block classes, tokens, comments that state *why*.
The Tailwind equivalent is given per block so the brief's intent stays traceable.

```css
/* ---------- catalogue explorer ---------- */

/* The screen opts out of the shell's 1040px reading measure. That cap exists for prose and
   record lists; a two-pane explorer is neither, and at 1040px the detail panel is 667px —
   too narrow for a feature row to carry code, name, count and timestamp without wrapping. */
.shell-main:has(.cat) {
  max-width: none;
}

/* Two panels, each scrolling in its own right, inside one viewport height.
   Tailwind: grid grid-cols-[300px_1fr] gap-5 h-[calc(100vh-...)] */
.cat {
  display: grid;
  grid-template-columns: clamp(260px, 28%, var(--explorer-w)) minmax(0, 1fr);
  gap: var(--sp-5);
  /* The header above is sticky; the panels take what is left and scroll inside it, which is
     what removes the page-level scroll the brief is about. dvh, not vh: on a phone the
     retracting browser chrome otherwise leaves the last row permanently under the fold. */
  height: calc(100dvh - var(--cat-head-h, 190px));
  min-height: 380px;
}

/* Sticky page header. Opaque, or tree rows show through as they scroll under it. */
.cat-head {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--paper);
  padding-bottom: var(--sp-4);
  margin-bottom: var(--sp-4);
  border-bottom: 1px solid var(--line);
}

/* ---------- explorer panel ---------- */

/* Deliberately NOT styled like the app rail. The rail is --surface-2 with a right border and
   no radius; this is a bordered, radiused card that sits inside the content area. A reader
   must never have to work out which of the two columns is the application's navigation. */
.cat-explorer {
  display: flex;
  flex-direction: column;
  min-height: 0;              /* lets the child scroll instead of the grid growing */
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.cat-explorer > .list-toolbar {
  margin: var(--sp-3) var(--sp-3) 0;
  max-width: none;            /* the toolbar's 360px cap is for a page-level filter */
}

/* The scroll container. overscroll-behavior: contain stops a flick at the end of the tree
   from scrolling the page behind it — the same rule .pick-list already uses. */
.cat-tree {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  list-style: none;
  margin: 0;
  padding: var(--sp-2);
}

/* A tree row. An <a>, so middle-click, Back and pre-hydration all work.
   Tailwind: flex items-center gap-2 h-[34px] px-2 rounded-md hover:bg-accent-wash */
.cat-node {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-height: var(--tree-row-h);
  padding: 0 var(--sp-2);
  padding-left: calc(var(--sp-2) + var(--level, 0) * var(--tree-indent));
  border-radius: var(--radius-sm);
  color: var(--ink-2);
  text-decoration: none;
  font-size: 13.5px;
  transition: background var(--ease), color var(--ease);
}
.cat-node:hover { background: var(--accent-wash); color: var(--ink); }

/* Selection is never colour alone: the row also takes a left stripe and 600 weight, so the
   choice survives greyscale and low vision. Same rule the .seg segments follow. */
.cat-node[aria-selected="true"] {
  background: var(--accent-wash);
  color: var(--accent);
  font-weight: 600;
  box-shadow: inset 2px 0 0 var(--accent);
}

/* The chevron is a button INSIDE the row, not the row itself: expanding a product and
   selecting it are two different intents, and merging them makes it impossible to look
   inside a product without also navigating. 24px target (WCAG 2.2 SC 2.5.8). */
.cat-twist {
  flex: none;
  display: grid;
  place-items: center;
  width: 24px; height: 24px;
  margin-left: -4px;
  border: none; background: none; padding: 0;
  color: var(--ink-3);
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: transform var(--ease), background var(--ease);
}
.cat-twist[aria-expanded="true"] { transform: rotate(90deg); }
.cat-twist:hover { background: var(--surface-2); color: var(--ink); }

/* The node's own label truncates; the title attribute carries the full name. */
.cat-node-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cat-node-id { font-family: var(--mono); font-size: 0.9em; color: var(--ink-3); }

/* Right-aligned child count. Tabular so a column of them does not jitter 9 → 10. */
.cat-count {
  flex: none;
  min-width: 22px;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--ink-3);
  font-size: 11.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
/* An empty branch says so quietly rather than reading as a loading state. */
.cat-count[data-zero] { background: transparent; color: var(--ink-3); opacity: 0.6; }

/* ---------- detail panel ---------- */

.cat-detail {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}
/* The record header stays put while its children scroll — you never lose track of which
   module you are inside halfway down a 40-feature list. */
.cat-detail-head {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--paper);
  padding-bottom: var(--sp-4);
}

/* A child row. .list-row's geometry with a fixed grid, because these rows are compared
   column-to-column rather than read as prose. */
.cat-child {
  display: grid;
  grid-template-columns: 110px minmax(0, 1fr) auto auto auto;
  align-items: center;
  gap: var(--sp-4);
  padding: var(--sp-3) var(--sp-5);
  border-bottom: 1px solid var(--line-soft);
  transition: background var(--ease);
}
.cat-child:last-child { border-bottom: none; }
.cat-child:hover { background: var(--accent-wash); }
@media (max-width: 900px) {
  .cat-child { grid-template-columns: 1fr auto; gap: var(--sp-2); }
}

/* ---------- responsive ---------- */

/* Tablet: one column, explorer behind a toggle, breadcrumb carries the position instead. */
@media (max-width: 1099px) {
  .cat { grid-template-columns: 1fr; height: auto; }
  .cat-explorer { display: none; }
  .cat-explorer[data-open] { display: flex; height: 60vh; }
}

/* Phone: the explorer is a <dialog> drawer. The app rail is already a top bar here
   (globals.css:2445), so a second column would leave the detail panel unreadable. */
@media (max-width: 760px) {
  dialog.cat-drawer {
    margin: 0; height: 100dvh; max-height: none;
    width: min(88vw, 340px); border-radius: 0 var(--radius) var(--radius) 0;
    animation: cat-drawer-in 200ms cubic-bezier(0.4, 0, 0.2, 1);
  }
  @keyframes cat-drawer-in { from { transform: translateX(-100%); } }
}
```

**Tailwind mapping, for the record.** If this were ported to Tailwind later, the tokens are
already the right shape for a `theme.extend` block: `--paper` → `bg-paper`, `--surface` →
`bg-surface`, `--accent-wash` → `bg-accent-wash`, `--sp-*` → the spacing scale, `--radius*` →
`rounded-{sm,ctl,DEFAULT}`, `--ease` → a named `transition-timing-function`. No colour value in
this document is a literal hex outside section 5's comparison table.

---

## 7. Accessibility

The screen is a WAI-ARIA **tree** beside a labelled region. Concretely:

**Structure**
```html
<div class="cat">
  <nav class="cat-explorer" aria-label="Catalogue browser">
    <div class="list-toolbar">…search, aria-label="Search the catalogue"…</div>
    <p class="sr-only" role="status" aria-live="polite">3 products match "login".</p>
    <ul class="cat-tree" role="tree" aria-label="Product, module and feature hierarchy">
      <li role="none">
        <a role="treeitem"
           aria-level="1" aria-setsize="4" aria-posinset="1"
           aria-expanded="true" aria-selected="false"
           tabindex="-1"                     <!-- roving: exactly one 0 in the tree -->
           href="/catalogue?sel=p:PROD001">…</a>
        <ul role="group">…level 2…</ul>
      </li>
    </ul>
  </nav>
  <section class="cat-detail" aria-labelledby="cat-detail-title" tabindex="-1">
    <h2 id="cat-detail-title">Checkout</h2>
    …
  </section>
</div>
```

**Nine specific things**

1. **Roving tabindex.** One Tab enters the tree, one Tab leaves it. Arrow keys move within.
   A 900-node tree must never be 900 tab stops.
2. **`aria-level` / `aria-setsize` / `aria-posinset`** on every treeitem — this is how a screen
   reader announces "Checkout, level 2, 4 of 12", which *is* the hierarchy the brief wants made
   obvious. It is the non-visual equivalent of the indentation.
3. **`aria-selected`, not `aria-current`.** The tree is a selection widget; `aria-current="page"`
   would be a lie in a single-page tree.
4. **Selection is three channels**: background wash, `--accent` ink, **and** a 2px inset left
   stripe plus weight 600. Never colour alone (WCAG 1.4.1).
5. **Focus moves to the detail panel** after a tree selection commits — `tabindex="-1"` on the
   `<section>` plus a `.focus()`. Without it, a keyboard user selects a module and their focus
   is still in the tree, with no announcement that anything changed.
6. **Search results are announced** via `role="status" aria-live="polite"`, debounced with the
   query. Silent filtering is invisible to a screen reader.
7. **24px minimum targets** on the chevron and the row overflow menu (WCAG 2.2 SC 2.5.8). The
   chevron is 24×24 inside a 34px row.
8. **Contrast, verified.** `--ink-3` on `--accent-wash` (the hovered *and* selected row
   background) is the tightest pair on the screen and was already tuned to clear 4.5:1 —
   `globals.css:35-37` records why `#6b7280` was rejected at 4.02:1. Reusing the token keeps
   that guarantee; a hard-coded `#9CA3AF` from the brief would not.
9. **`prefers-reduced-motion`** already zeroes every transition globally (`globals.css:196`).
   The chevron rotation and the drawer slide inherit that — nothing extra to write.

Every item on `DESIGN-SYSTEM.md` § "Accessibility checklist for new screens" is satisfied by
construction, plus the tree-specific ones above.

---

## 8. Empty states

Five, not four. Each names the situation, explains it in one sentence, and offers the *one*
action that resolves it.

| State | Icon | Copy | CTA |
|---|---|---|---|
| No products at all | `FolderTree` | **The catalogue is empty.** Products are the top of the hierarchy — everything else hangs off one. | `+ New product` |
| Product has no modules | `Folder` | **PROD004 has no modules yet.** A module groups the features of one product. | `+ Add module to PROD004` |
| Module has no features | `Component` | **MOD007 has no features yet.** Features are what test cases are written against. | `+ Add feature to MOD007` |
| Feature has no requirements | `ListChecks` | **FEAT022 has no requirements yet.** Requirements are what the RTM traces coverage against. | `+ Add requirement to FEAT022` |
| Search matched nothing | `SearchX` | **Nothing matches "paymnt".** Search looks at business IDs and names across all four levels. | `Clear search` |
| *(kept)* Page past the end | — | existing `ListEmpty` component, unchanged | `Go to the first page` |

That last row matters: `src/ui/list-empty.tsx` exists precisely because a list can render zero
rows for two different reasons, and its header documents the bug that happened when a screen
guessed wrong. The requirement list — the only one still paged — keeps using it.

```css
/* An empty state with room for an icon. The plain .empty stays for inline cases. */
.empty-rich { padding: var(--sp-7) var(--sp-5); text-align: center; }
.empty-rich > svg {
  width: 40px; height: 40px;
  color: var(--ink-3);
  opacity: 0.5;              /* present, not decorative noise — the sentence is the message */
  margin-bottom: var(--sp-3);
}
.empty-rich h3 { margin-bottom: var(--sp-1); }
.empty-rich p { max-width: 44ch; margin: 0 auto var(--sp-4); }
```

Icons are `lucide-react`, already a dependency and already the project's icon set
(`DESIGN-SYSTEM.md` § Icons). No illustration assets, no SVG payload.

---

## 9. Keyboard shortcuts

**Tree (WAI-ARIA `tree` pattern — matching the spec exactly, not approximately):**

| Key | Action |
|---|---|
| `↓` / `↑` | Next / previous **visible** node (crosses levels; a collapsed branch is skipped) |
| `→` | Closed node → open it. Open node → move to first child. Leaf → nothing. |
| `←` | Open node → close it. Closed/leaf → move to parent. |
| `Home` / `End` | First / last visible node |
| `Enter` / `Space` | Select the focused node (navigate; focus moves to the detail panel) |
| `*` | Expand every sibling at the current level |
| type-ahead | Typing letters jumps to the next node whose label starts with them |

**Screen:**

| Key | Action |
|---|---|
| `⌘K` / `Ctrl K` | Focus the catalogue search |
| `/` | Same, when focus is not already in a field |
| `Esc` | In search → clear it. In the tree → return focus to search. In a modal → close (existing). |
| `N` | Trigger the contextual Add for the current selection |
| `E` | Edit the selected record |
| `[` | Toggle the explorer panel (tablet and below) |

`⌘K` and `/` are global-ish listeners; both must no-op while focus is in an `input`,
`textarea`, `select` or `[contenteditable]`, and while a modal is open. The `Modal` component
already traps focus and owns `Esc`, so the screen-level `Esc` handler must check for an open
dialog first.

**[needs a decision]** `⌘K` is conventionally a *global* command palette. Binding it to one
screen's search now means either renaming it later or having two `⌘K`s. Recommendation: ship
`/` as the primary and `⌘K` as an alias on this screen, and reserve `⌘K` for a future
application-wide palette.

---

## 10. Motion

One voice, already defined: `--ease: 200ms cubic-bezier(0.4, 0, 0.2, 1)` — inside the brief's
150–250ms band. Nothing new is introduced.

| Interaction | Treatment | Why |
|---|---|---|
| Chevron expand | `transform: rotate(90deg)` over `--ease` | The only rotation on the screen; it means "this opened" |
| Branch open | `grid-template-rows: 0fr → 1fr` over `--ease` | Height-animates without a measured pixel value or a layout thrash |
| Row hover | `background` over `--ease` | Already how `.list-row` behaves |
| Selection change | **No transition on the detail panel** | It is a server navigation. A cross-fade over a round trip reads as lag, not polish. |
| Detail loading | `.skeleton` in the panel's shape | The existing shimmer, via `loading.tsx`. Shape-of-the-page, not a spinner. |
| Search in flight | `.list-toolbar[data-busy]` dims the magnifier | Already built. A spinner per debounced keystroke is worse than the wait. |
| Row added | New row highlights `--accent-wash` → transparent over 600ms, once | Answers "where did it go?" after a modal closes |
| Drawer (phone) | `translateX(-100%) → 0` over `--ease` | Says which edge it came from |

Everything above is switched off by the global `prefers-reduced-motion` rule. Explicitly *not*
proposed: parallax, gradient washes, spring physics, staggered list entrance. The brief asks for
clarity over decoration and the design system says the accent stays quiet.

---

## 11. Final layout description

At 1440px, the QA Lead opens `/catalogue`. The 248px application rail is on the left, as on
every screen. To its right, a sticky header: **Catalogue**, the lede *Product → Module →
Feature → Requirement*, four compact stat cards (4 products · 18 modules · 62 features · 241
requirements), and a single primary button on the right reading **New product** — because
nothing is selected yet.

Below the header, two panels fill the remaining viewport height and neither the page nor the
body scrolls. The left panel, 300px, is a bordered card: a search field across the top, then
four product rows, each with a folder icon, its business ID in mono, its name, and a
right-aligned module count. The right panel says *Pick something to see it*, restates the
totals, and lists the three most recently updated records as links.

The Lead types `check` into the search. After 300ms the tree redraws server-side: one product
remains, auto-expanded, with one module — Checkout — and beneath it two matching features. A
line above the tree, announced to screen readers, reads *3 records match "check"*.

They click **MOD004 Checkout**. The URL becomes `/catalogue?sel=m:MOD004&q=check`. The tree row
takes an accent wash, accent ink, weight 600 and a 2px left stripe. Focus moves to the detail
panel. Its header — sticky, so it survives the scroll below it — reads **Retail Banking /
MOD004** as a breadcrumb, **Checkout** as the title, then a fact line: *MOD004 · record
version 3 · 12 features · 48 requirements · updated 2026-08-05 14:22 UTC by R. Panes*, plus the
inherited product context (*Retail Banking v2.1*, ● Active) and an **Edit** button that opens
the existing modal with its hidden `id`/`version` pair intact. The header button has changed
from **New product** to **Add feature** — the selection decided the parent.

Under the header, a flush card of twelve feature rows: business ID in mono at a fixed 110px,
name, a requirement-count badge, a relative timestamp, and — on hover — an inline Edit and an
overflow menu. The list scrolls inside the panel. The tree does not move.

They press **N**. The Add-feature modal opens with the module field pre-filled and locked to
MOD004 — no dropdown of every module in the catalogue. They enter `FEAT013` and `Apple Pay`,
submit. `createFeatureAction` calls `createFeature`, which checks the QA-Lead role, validates
`FEAT###`, rejects a duplicate ID, writes inside a transaction and appends a `FEATURE_CREATED`
audit event. `revalidatePath` then `refreshScreen` returns to the same URL with the same
selection. The modal closes, a toast confirms, the tree count on MOD004 goes 12 → 13, and the
new row flashes accent once in the feature list. Nothing scrolled. Nothing was lost.

At 1024px the explorer folds behind a **☰ Browse** toggle and a breadcrumb carries the
position. At 600px the app rail is already a top bar, so **Browse** opens a left drawer that
closes on selection; the detail panel is the whole screen and the stat cards become one line of
text. In light mode every surface, border and ink comes from the same tokens and the screen is
simply light — because not one hex value is hard-coded anywhere in it.

---

## 12. Delivery plan

Five commits, each of which builds, typechecks, lints and leaves the screen working.

| # | Commit | Touches | Risk |
|---|---|---|---|
| 1 | `feat: read the catalogue as a tree` — `listCatalogueTree`, `catalogueTotals`, the three detail getters, `selection.ts` + its test. Screen unchanged. | `src/domain/catalogue.ts`, `selection.ts` | Low — additive |
| 2 | `feat: two-pane frame and tree` — CSS blocks, `CatalogueExplorer`, `TreeNode`, mouse only. Detail panel renders the four old lists inside it. | `globals.css`, new components | Medium — layout |
| 3 | `feat: detail panel per selection` — record header, child lists, five empty states, **and the contextual CTA**. The four stacked tables come out. | `page.tsx`, `DetailPanel`, `CatalogueForms.tsx` | Medium — this is the cutover |
| 4 | `feat: keyboard navigation and search` — roving tabindex, the ARIA tree contract, the search box wired to `q`, shortcuts. | explorer components | Low |

**Amended during delivery.** Commits 3 and 4 were merged. Removing the four stacked
sections also removes the four `Add` buttons attached to them, so shipping the cutover
without the contextual CTA would have left one commit on the branch where nothing in the
catalogue can be created. Every commit has to be a working screen, so the CTA moved
forward. The stale `listProducts` comment (§0.6) was corrected in commit 1 instead of
commit 5 — that is the commit that made it false.

**Tests.** `selection.test.ts` (pure parse/serialise, following `navigation.test.ts`), and a
`CatalogueExplorer.test.tsx` under `@testing-library/react` covering arrow-key movement,
expand/collapse, and that `aria-level`/`aria-setsize` match the rendered structure — the same
shape as the existing `case-table.test.tsx` and `work-queue.test.tsx`.

**Docs.** `DESIGN-SYSTEM.md` § Components gains the tree, count badge and rich empty state.
Nothing in `docs/` changes, because nothing here is policy — **unless** the two
**[needs a decision]** items (a Module `owner` field; the `⌘K` reservation) are taken up, in
which case `docs/data-model.md` and `docs/testing-and-acceptance.md` change with them.

**Not in scope, deliberately:** widening the QA-Lead gate, deleting catalogue records (no
delete exists today and `onDelete: Restrict` is on every relation), reordering the hierarchy,
and editing business IDs or parent links — all four are immutable by `docs/data-model.md`.
