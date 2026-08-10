# The catalogue tree stops at Feature

Status: accepted

The catalogue explorer's tree draws Product → Module → Feature. Requirements are not tree
nodes: they are read in a feature's detail panel, which pages them, and reached directly
through search, which ranks and bounds them.

The hierarchy is still four levels — `docs/data-model.md` is unchanged and Requirement is
still a first-class record with its own detail view, breadcrumb and edit modal. This is a
decision about what the *tree widget* draws, not about what the catalogue contains.

## Why

A requirement has no name. Its label is its statement — a whole sentence, often twenty or
thirty words — and the tree row it was given is a ~300px column with three levels of
indent already spent. Every requirement row truncated to the first three or four words,
which is precisely the number of words that does *not* distinguish one requirement from
another.

Requirements also outnumber the other three levels several times over, and that ratio
grows: a feature acquires requirements for as long as it is being specified, while a
product acquires modules once. The level with the most rows and the least readable rows
was the one being rendered in the narrowest space.

The screen already had a better place for them. A feature's detail panel is wide, pages its
child list, and gives each row a timestamp and an edit affordance. The requirement was
rendered in both places; only one of them could actually be read.

## Considered

- **Keep four levels, cap them in the tree** (show the first 20, then "+ N more"). Rejected
  as the worst of both: still truncated, still the widest rows in the narrowest column, and
  now also incomplete.
- **Keep four levels, widen the tree.** A width that makes a thirty-word statement legible
  is a width that leaves no room for the detail panel — and the panel holds the record you
  are actually reading.
- **Keep four levels unbounded** (the shipped behaviour). A feature with 300 requirements
  put 300 DOM rows behind one chevron click.

## Consequences

- `?open=FEAT012` no longer means anything; `parseOpenSet` drops feature and requirement
  IDs, and `resolveOpenIds` resolves two levels rather than three.
- A selected requirement has no row in the tree, so nothing carries `aria-selected` and the
  tree's single tab stop falls back to its first row. `selectedIsRendered` handles this
  explicitly — it is a normal state, not an edge case.
- Search is the only direct route to a requirement, which is part of why
  [ADR-0002](0002-catalogue-search-is-a-flat-ranked-list.md) makes requirements
  first-class search results.
- The browse-mode read loses an unbounded query: requirements are never fetched for the
  tree at any depth.
