# A later run transitions its issue again, and a declined transition is recorded

Status: accepted

An issue that QAMS has already transitioned is transitioned **again** when a run that
finalized *after* that transition passes every case. And every finalize that declines to
transition now writes a `SKIPPED` attempt saying why, instead of returning silently.

This amends the trigger described in
[ADR-0003](0003-jira-sync-is-decoupled-from-finalize.md), which stands in every other
respect. Policy lives in `../architecture.md#Jira execution sync`; this record is only the
engineering reasoning, and where the two disagree that document is right.

## What went wrong

The original rule was *transition once per issue, ever*: a single `SUCCEEDED` row for an
issue key suppressed every later transition for that key, forever. It was written to stop a
regression re-run from silently re-closing a ticket that a person had deliberately moved back
to In Progress, which is a real concern and remains one.

It was reported as "I finalized the execution and the status in Jira did not update to Done",
and the sequence was:

1. A run was pointed at an issue, finalized all-Pass, and QAMS transitioned the issue to Done.
2. A person moved the issue back — through Building, then Testing — and work continued.
3. A **second, separate run** covering thirteen cases was planned against the same issue,
   finalized, and passed every one of them.
4. QAMS evaluated the trigger, found it satisfied, found the `SUCCEEDED` row from step 1, and
   returned. No transition, no attempt row, no audit event, nothing on the run screen.

The result comment for step 3 posted normally, because comments have no such guard
(ADR-0004). So the integration looked half-broken from the outside, and the only way to learn
that it had worked exactly as written was to read the source.

## Why the rule changed rather than the reporting

The old rule conflated two questions. "Has this issue ever been transitioned?" is cheap and
was what the code asked. "Has anything happened since we last said this issue was finished?"
is what it meant. Eligibility is a property of the whole issue key, so it stays true forever
once met — which is precisely why a rule anchored on *ever* can never expire.

`transitionAlreadyCovers` asks the second question: an issue is covered when the last
successful transition is at least as recent as every run carrying the key. A run finalized
after it is new evidence and earns a fresh transition. A replay of work already reported is
not, so the protection the old rule provided — one transition per body of work, and no
re-closing a ticket from a repeat of the same finalize — survives intact.

**The alternative was to ask Jira for the issue's current status** and skip when it is
already in the `done` category, which is the most direct statement of the intent. It was
rejected for now: it adds a request to a path that already has two, a second failure mode on
a deadline that exists to protect a tester's response, and a new decision about what to do
when the status read itself fails. It remains the better answer if re-transitioning ever
proves noisy in a workflow that does not offer a done transition from a done status.

**Re-transitioning an already-done issue is cheap where it is legal.** Jira has no way to set
a status, so the transport lists the transitions available from the issue's current status
and picks one whose target is in the `done` category (`pickDoneTransition`). A workflow that
offers a done transition from a done status treats the repeat as a no-op; one that offers
none records a failed attempt naming that reason, which is honest and visible.

## Why a declined transition is now recorded

Because the three outcomes a reader needs to tell apart looked identical from outside:

| What happened | Before | After |
| --- | --- | --- |
| QAMS moved the issue | `SUCCEEDED` row | unchanged |
| QAMS tried and Jira refused | `FAILED` row, retried | unchanged |
| QAMS chose not to | **nothing at all** | `SKIPPED` row, with the reason |

The third case is not rare and is usually not a defect. The common one is the trigger doing
its job: the issue is held open by a *different* run sharing the key — one still Planned, or
one that failed weeks ago — which a tester cannot see from their own run. Answering that on
the run screen turns a support request into a glance.

`SKIPPED` is inert to everything that already reads `JiraSyncAttempt`. The retry worker
queues on `FAILED`, so it is never retried; an issue is settled by `SUCCEEDED` or
`ABANDONED`, so it never settles one; the transition guard reads `SUCCEEDED`, so it never
suppresses a later transition. It adds a story without altering any existing one — which is
the same reasoning that gave result comments their own table in ADR-0004, applied to a value
rather than a table.

Its `actorId` is always null, and that is a third meaning for a column that already carried
two. On a row that reached Jira, null means the service-account fallback performed the write
rather than a person. On a `SKIPPED` row it means no credential was used because no call was
made. The two are distinguishable by `outcome`, which any reader of the column has in hand.

## Consequences

- An issue can now be transitioned to Done more than once over its life. Each transition is
  attributable to the run that earned it, and a board watcher may see a ticket close, reopen
  by hand, and close again — which is what actually happened.
- `JiraSyncAttempt` grows a row on finalizes that previously wrote nothing. It is append-only
  and indexed on `executionId` and `jiraIssueKey`, and the volume is one row per finalize of a
  run carrying a key.
- A tester now sees why an issue did not move, including the business ID of a run that is not
  theirs. That is a deliberate, small widening of what one run's screen reveals about another,
  on the same reasoning that shows them a failed comment: the person looking at the run is the
  one best placed to chase it.
- The concurrent case is narrowed, not closed. Two runs on one key finalizing at the same
  instant can both read "nothing since", and closing that needs a partial unique index on
  `(jiraIssueKey) WHERE outcome = 'SUCCEEDED'` that Prisma's schema language cannot express.
  The duplicate is a second `SUCCEEDED` row and a repeat transition Jira treats as a no-op.
- Until this defect, no test had ever driven `finalizeExecution` with a transport installed;
  `shouldTransitionIssue` was tested in isolation and the wiring around it was not tested at
  all. The gap between the two is exactly where the defect lived. `tests/acceptance/jira-sync.test.ts`
  now covers the trigger end to end.
