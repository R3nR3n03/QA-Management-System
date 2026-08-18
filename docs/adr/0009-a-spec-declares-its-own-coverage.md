# A spec declares its own coverage

Status: accepted

QAMS stores no link between a test case and the automation that checks it. A spec names the test
case business ID it covers, in its own file, in the repository of the software under test; QAMS
resolves that ID when results are ingested and records it on the check. A revised test case
inherits nothing from the case it revises.

Policy for this lives in `../business-rules-and-validation.md` § "Automation check rules" and
`../architecture.md#Automation check ingestion`. This record is only the engineering reasoning;
where they disagree, those documents are right.

## Why

**A stored binding is a claim QAMS cannot check, about a repository it cannot see.** A binding row
says "spec X covers TC-PROD001-0001". Nothing in QAMS can verify that: it cannot open the file,
cannot learn that the spec was renamed, deleted, or rewritten to assert something else, and has no
event that would tell it. The row goes on asserting coverage that stopped existing — and the
failure is silent. No error, no empty result, just a standing claim nobody re-checked. Where the
spec carries the ID itself, a rename that drops it produces an unresolvable row on the next
upload, which is a line in a report a person reads.

**The declaration belongs where the change happens.** Whoever renames the button is editing the
spec, in the repository they are already in. A binding held in QAMS is a second place to remember,
owned by a different team, reached through a different screen, and it will be updated last or not
at all. Putting the ID in the spec makes the coupling visible to the only person positioned to
maintain it.

**A revision states different expected behaviour, so inherited coverage is a false green.** A
test-case revision is a new record, deliberately — `revisesTestCaseId` links it to its predecessor
rather than overwriting one. It exists because the expected result changed. Carrying the old
binding forward would point yesterday's assertions at today's expectations and report `Passed`,
against a case nobody confirmed the spec still covers. Of everything this feature could get wrong,
that is the one that manufactures false assurance rather than merely losing some.

**Silence is the safe direction here.** With no inheritance, a freshly revised case shows no checks
until somebody points a spec at it. That reads as "not yet automated", which is true, and it is
visible on the case's own screen. The alternative reads as "verified", which is false, and looks
identical to the real thing.

## Considered

- **A `specPath` column on `TestCase`.** Simplest, and it dies at every revision anyway, since a
  revision is a new row — so it delivers the drift risk without even delivering continuity.
- **A binding table, allowing many-to-many.** The obvious design, and the one most systems build.
  Rejected on the first argument: it is an unverifiable assertion about another repository, whose
  failure mode is silence rather than an error.
- **Inheriting coverage across revisions.** Rejected on the third argument. It is convenient
  exactly when it is most dangerous.
- **A coverage report derived from bindings** — "which approved cases have no automation".
  Rejected along with the bindings it would have read. The observed version is available instead:
  a case with no check has never been checked, which is a weaker statement and a true one.
- **Requiring the ID in a structured attribute rather than the test name.** Cleaner in principle
  and unavailable in practice: JUnit XML has no agreed place for one, and the test name is what
  every runner emits and every reader already reads.

## Consequences

- QAMS cannot answer "which approved cases have automation" from anything it stores. It can only
  report which cases have received a check. The two differ whenever a spec exists but has never
  been run, and QAMS will report the latter.
- A renamed or deleted spec stops reporting silently until its next upload, where its rows resolve
  to nothing and the batch report names them. That is a delayed signal rather than an immediate
  one, and it is the strongest available given QAMS cannot see the repository.
- Re-binding after a revision is manual and easy to forget. The consequence of forgetting is a
  revision that shows no checks — visible, and in the safe direction.
- A test case's business ID is now load-bearing outside QAMS. It was already immutable
  (`../data-model.md`), so nothing about the record changes; but a person reading a spec file now
  depends on that guarantee holding, and this is the first time anything outside this system has.
- Two specs may both name one test case, and one spec may name several. Nothing prevents or records
  that intent — the checks simply arrive, each naming the spec that produced it.

Decided with the QA Lead on 2026-08-18.
