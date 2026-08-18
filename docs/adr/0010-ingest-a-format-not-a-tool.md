# Ingest a format, not a tool

Status: accepted

The V1 exclusion on automation-framework integration is lifted for a **format** — JUnit XML —
rather than for Cypress. Any runner emitting that format is covered by the same approval, and
adding a second runner requires no further QA Lead decision.

Policy for this lives in `../architecture.md` § "V1 exclusions" and
`../api-and-security.md#Automation check ingestion interface`. This record is only the engineering
reasoning; where they disagree, those documents are right.

## Why

**The risk being governed is identical whichever binary wrote the file.** The exclusion exists
because machine-produced observations entering QAMS is a category the QA Lead wanted to decide on
deliberately. That concern is about the observations, not the process that emitted them: a
`Failed` row means the same thing, carries the same weight on a screen, and is wrong in the same
way whether Cypress, Playwright or pytest produced it. Approving per tool would govern a variable
the risk does not depend on.

**Per-tool approval is unenforceable from here.** [ADR-0009](0009-a-spec-declares-its-own-coverage.md)
puts the specs in the repository of the software under test. QAMS never sees them, never invokes
them, and has no event telling it that a team swapped runners. An approval naming Cypress would be
satisfied or violated entirely outside this system's view — which makes it a rule that cannot fail
loudly, the same objection ADR-0009 raises against stored bindings.

**The format's own vocabulary already matched the outcomes.** JUnit XML distinguishes a failure, an
error and a skip. `CheckOutcome` was derived independently in
[ADR-0008](0008-a-check-reports-an-execution-claims.md), from the observation that a spec can fail
an assertion, crash before reaching one, or not run at all — and arrived at the same three. An
independently-derived model matching a decades-old interchange format is evidence the distinctions
are real rather than ours.

**Every runner worth supporting already emits it.** This is the cheapest integration surface
available: one reporter configuration line in somebody else's repository, and no QAMS change at
all when a second team joins.

## Considered

- **Naming Cypress in the approval.** The narrower, more conservative-looking option, and rejected
  as governance theatre: it constrains something QAMS cannot observe, while the thing it actually
  cares about — a results file arriving — is unchanged either way.
- **Cypress-native JSON, or mochawesome.** Richer: screenshots, full stack traces, timing detail.
  Rejected because it couples both the parser and the policy to one tool, and buys richness this
  feature does not use — a check stores an outcome and a reason, not an artefact.
- **A QAMS-defined JSON contract with an adapter per runner.** The cleanest shape for QAMS, and it
  pushes the work onto whoever writes the adapter while inventing a format nobody else speaks.
  Rejected: the adapter is one more place for the test-case ID to be lost, and JUnit XML is already
  the lingua franca it would be reinventing.

## Consequences

- Adding Playwright, Vitest or pytest needs no approval here. That is intended, and
  `../architecture.md` states it explicitly rather than leaving it as an implication, so that
  nobody can later argue a second runner was smuggled in under a Cypress decision.
- QAMS never learns which tool produced a file beyond what the XML happens to say. A check names
  its spec and its test; it does not name a runner, and cannot.
- JUnit XML is lossy. Screenshots, videos, retries and full stack traces do not survive it, and a
  failure reason is whatever the reporter chose to put in the message attribute. Investigating a
  failure means going to the run in its own tooling — QAMS records that it happened, not the
  evidence for it.
- **The `Failed` / `Errored` split depends on how a reporter fills the file, and reporters
  differ.** The rule as built: an `<error>` element is always `Errored`; a `<failure>` is
  `Failed` when its `type` attribute names an assertion or is absent, and `Errored` otherwise.
  The absent case resolves to `Failed` deliberately — that is the element the format itself
  chose, and guessing against it would quietly stop reporting real failures, which loses a bug
  rather than wasting an hour.

  `mocha-junit-reporter`, the usual Cypress path, is understood to emit `<failure>` for both
  assertion failures and thrown errors, which is why the `type` attribute carries the
  distinction rather than the element name. **This has not been verified against a live Cypress
  run**, and a reporter that omits or reuses `type` collapses the two into `Failed`. It is the
  one place this design depends on a detail QAMS does not control, and it is worth confirming
  against whichever reporter a team actually adopts.

Decided with the QA Lead on 2026-08-18.
