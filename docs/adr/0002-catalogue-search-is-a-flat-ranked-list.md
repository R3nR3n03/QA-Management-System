# Catalogue search is a flat ranked list, not a filtered tree

Status: accepted

Typing in the catalogue explorer's search box replaces the tree with a flat, ranked,
`LIMIT`-bounded list of hits. Each row carries its own ancestry on a second line —
`PROD001 Retail Banking › MOD004 Checkout` — and the matched substring is marked. The tree
returns when the needle is cleared.

## Why

Search used to filter the tree in place. Every match dragged its ancestors on screen, and
every branch that survived was force-expanded so no result could hide behind a chevron.
That is a genuinely good design at the size the screen was written for, and it fails in two
separate ways as the catalogue grows.

**What it cost to produce.** Building the filtered tree meant reading the *whole* Product,
Module and Feature tables on every committed keystroke and filtering them in JavaScript.
Ancestors cannot be resolved any other way without recursive queries, so the cost was
structural, not an oversight — three full table reads per search, growing linearly with the
catalogue, forever.

**What it produced.** A two-letter needle matched a large fraction of the catalogue and
expanded all of it. The output was unbounded for the same reason the input was: nothing in
the design could say "and that is enough".

The ancestry the expanded branches existed to show is one line per hit in a list. Same
information, one row instead of four, legible at any depth — and now the database can do
the matching under a `LIMIT`.

## Considered

- **Keep the filtered tree, collapse to matched branches.** Fixes the render but not the
  read: the whole spine still has to be fetched to know where a match lives.
- **Hybrid** — list above a result threshold, tree below it. Two behaviours for one control,
  switching on a number the viewer cannot see. A search box that changes shape as you type
  is harder to trust than one that does not.
- **Recursive CTE to resolve ancestors.** Would bound the read, but keeps the unbounded
  render and moves the matching rules out of a pure, tested function into SQL.

## Consequences

- Ranking is done in TypeScript (`src/domain/catalogue-search.ts`), not `ORDER BY`. Four
  levels are four queries, and concatenating four separately-ordered result sets would put
  every product above every requirement whatever was typed. The ordering rules are pure and
  unit-tested without a database.
- The result count on screen is a floor, not a total. The UI says so rather than reporting
  the cap as an answer; knowing the true size of a set nobody will read would cost a
  `COUNT(*)` per level on a predicate no index can serve.
- Requirements are first-class hits. Following [ADR-0001](0001-catalogue-tree-stops-at-feature.md)
  they have no tree row, so search is the only direct route to one.
- `ILIKE '%needle%'` cannot use a btree index, so migration
  `20260808010000_catalogue_search_trgm` adds `pg_trgm` GIN indexes on the four searched
  text columns. That migration needs privileges to `CREATE EXTENSION`; run it as the
  database owner.
- Browsing and searching are exclusive. When a needle is present the tree is not fetched at
  all, and vice versa — neither mode pays for the other.
