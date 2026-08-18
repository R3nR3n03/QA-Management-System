# A check reports, an execution claims

Status: accepted

QAMS ingests automation results and stores them as **checks**, in their own table, referencing a
test case directly. A check never becomes an execution and no execution result is ever derived
from one. An execution stays what it always was: one person's claim that they ran some approved
test cases, and what they found.

Policy for this lives in `../business-rules-and-validation.md` § "Automation check rules",
`../data-model.md`, and `../architecture.md#Automation check ingestion`. This record is only the
engineering reasoning; where they disagree, those documents are right.

## Why

**The required fields of `TestExecution` stop being true.** `testerId` is a non-null foreign key
to a real user, and the model means it: `listExecutionsForTester` builds a person's queue from
it, reassignment is a documented transition with its own rules, and the tester freezes when the
run leaves Planned. A machine result has no tester. Making the column nullable would not model a
bot — it would make every existing query's assumption conditional, in a table where "who ran
this" is the entire point of the record.

**Finalization requires narrative a spec cannot write.** Every finalized case carries a non-blank
`actualResult`; a `Fail` requires a defect referencing that specific case; a `Blocked` requires a
block reason. Those three rules are what stop a run being finalized without anyone saying what
happened. Admitting machine results into the same table means either writing placeholder prose
into `actualResult` — which corrupts the field for every reader who relies on it being a person's
sentence — or switching the rules off for some rows, which leaves the strongest guarantee in the
system holding only sometimes, and only for rows a reader cannot identify.

**A shared record makes the two indistinguishable, which is the failure mode rather than a side
effect.** Execution history is what QAMS shows when someone asks whether a case was verified. If
half those rows were machine observations, "this case passed" would mean two different things
depending on a column nobody prints. The system exists to make QA claims auditable; a claim whose
author might be a program is not an auditable claim.

**The outcomes do not overlap cleanly in either direction.** `ExecutionOutcome` is
`PASS | FAIL | BLOCKED`. A spec is never blocked — blocking is a person reporting that they could
not proceed, which is why the rules demand a reason from them. But a spec can **error** before
reaching any assertion, and can be **skipped** by its runner, neither of which an execution has
ever been. A shared enum would carry one impossible state and lack two necessary ones. That is
exactly the test [ADR-0004](0004-result-comments-are-posted-on-every-finalize.md) applied when it
refused to share `JiraSyncAttempt`.

**`Errored` is not a kind of `Failed`.** A failure is the software under test disagreeing with an
expectation. An error is the spec never reaching one — a bad selector, an unreachable
environment, a crash in setup. Collapsing them reports a broken spec as broken software, which is
the most expensive wrong answer this feature could give: it sends somebody to debug an
application that is fine, and it does so with QAMS's authority behind it.

## Considered

- **One `TestExecution` per automation run, attributed to a service-account user.** The cheapest
  schema and what most systems ship. Rejected on all five arguments above — and the service
  account is the tell: inventing a fictional person to satisfy a foreign key is the model
  objecting to the design, not an implementation detail to work around.
- **A `source` discriminator on `TestExecution`.** One migration instead of two tables, and
  rejected on ADR-0004's precedent. Every existing query would need a filter it does not have
  today, and the failure mode of forgetting one is a machine observation counted as human
  verification — silently, and in the direction that overstates assurance.
- **Checks as proposals a person promotes into an execution.** Genuinely attractive: a human stays
  accountable for every claim while machine output is still captured. Rejected as premature — it
  invents a review queue nobody has asked for, and it remains available later, because a promotion
  step that reads checks and writes an execution changes nothing decided here.
- **Reusing `ExecutionOutcome`, mapping `ERRORED` onto `FAIL`.** Rejected above; the mapping is
  the bug.
- **Reusing `ImportRun` for the batch.** Its vocabulary — `SKIPPED_UNCHANGED`,
  `RECONCILIATION_REQUIRED`, a source hash meaning "have we seen this file" — is meaningless for
  observations, which are never unchanged and never reconciled. Same test, same answer.

## Consequences

- There are now two tables answering "what happened to this test case", and a reader has to know
  which one they are looking at. The screens carry that weight: checks appear in their own
  section and are never interleaved with execution history.
- Nothing counts checks. Release readiness, the traceability matrix and the dashboard are
  unchanged, which will read as a gap to anyone expecting automation to move a coverage number.
  It is deliberate. `../roles-workflows.md` forbids inferring release criteria, and a metric that
  quietly starts counting machine reports is that inference wearing a number.
- A test case can be checked a thousand times and remain uncovered by any execution. That is an
  honest description of a suite nobody has verified, and it will look worse than a single blended
  figure would — which is the point of reporting it separately.
- Checks accumulate without bound. Volume is not a PostgreSQL problem at any plausible scale here,
  but a test case's screen must cap what it lists and say how much it left out, or a reader takes
  a truncated list for a complete history.
- QAMS now stores a record whose author is not a person. `actorId` on a check batch names whoever
  uploaded the file, which is the honest answer — somebody carried these results in, and nobody
  claims they verified them.

Decided with the QA Lead on 2026-08-18.
