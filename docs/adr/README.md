# Architecture decision records

Engineering decisions and the reasoning behind them: what was decided, what the
alternatives were, and why one won. One file per decision, numbered sequentially.

**These carry no policy authority.** `docs/` is the single source of truth for QAMS policy
and business rules, under the order set out in [`../README.md`](../README.md); this
subdirectory is not part of that order and sits below every document in it. An ADR records
how the implementation was built, never what the system is required to do. Where an ADR and
a policy document appear to disagree, the policy document is right and the ADR is stale.

An ADR is written only when a decision is hard to reverse, surprising without context, and
the result of a real trade-off. If any of the three is missing there is nothing worth
recording.

| ADR | Decision |
| --- | --- |
| [0001](0001-catalogue-tree-stops-at-feature.md) | The catalogue tree stops at Feature; requirements are read in the detail panel |
| [0002](0002-catalogue-search-is-a-flat-ranked-list.md) | Catalogue search is a flat ranked list, not a filtered tree |
| [0003](0003-jira-sync-is-decoupled-from-finalize.md) | Jira sync is decoupled from finalize, and triggers on the last passing execution |
| [0004](0004-result-comments-are-posted-on-every-finalize.md) | Result comments are posted on every finalize, in their own table and without retries |
| [0005](0005-a-later-run-transitions-its-issue-again.md) | A later run transitions its issue again, and a declined transition is recorded |
