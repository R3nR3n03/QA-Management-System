# Business Rules and Validation

## Validation outcomes

Every rejected request returns HTTP `422` with stable error code, field path, and human-readable message. Unauthorized actions return `403`; missing records return `404`; conflicting record versions or business IDs return `409`. Validation happens before persistence and database constraints are the final safeguard.

## Identity and reference rules

| Rule | Error code |
| --- | --- |
| Business IDs match their documented prefix and are unique within entity type. When an interactive create request does not supply one, the system allocates the next free ID in the documented format; a supplied ID is validated exactly as before. | `ID_INVALID` / `ID_DUPLICATE` |
| Every referenced record exists and is active where active status is required. | `REFERENCE_NOT_FOUND` / `REFERENCE_INACTIVE` |
| Product → Module → Feature → Requirement references form one chain. | `HIERARCHY_MISMATCH` |
| Only active controlled values are accepted. | `CONTROLLED_VALUE_INVALID` |
| Required free text is non-blank after trimming, and where a maximum length is documented it is measured after trimming. An execution's `purpose` is the only field carrying a length limit. | `ID_INVALID` |
| Update requests include the current optimistic `version`. | `VERSION_CONFLICT` |

## Test-case rules

- Required before review: Product ID, Module ID, Feature ID, Requirement ID, Cycle, Sprint, Release, Environment, Priority, Severity, Title, Objective, Expected Result, and one or more steps.
- `title`, `objective`, `expectedResult`, step `action`, and step `expectedResult` are non-blank after trimming.
- Step sequences are integers `1..n`, unique per test case, and contain no gap.
- Only a Draft case can be edited. Submission and approval enforce the role and transition table in `roles-workflows.md`.
- A case cannot be retired if it is Draft or In Review; resolve or reject the review first.

## Execution and defect rules

- An execution is created Planned for one or more Approved test cases and exactly one assigned tester.
- An execution carries a required `purpose`: one line stating what the run exists to check. It is non-blank after trimming, at most 120 characters measured after trimming, and stored trimmed. A blank or over-long purpose is `ID_INVALID` on `purpose`. It is not unique — several runs covering the same check across browsers, environments, or reruns are expected to share one — and it never identifies a run; `EXE-####` does. It is the headline the run is listed under in the executions list and in the assigned tester's queue.
- The purpose, the assigned tester, and the Jira issue key may be changed only while the execution is Planned; after it starts, all three are part of the record and a change is `FORBIDDEN_TRANSITION`. A purpose is never cleared, because a run always has one.
- Start records `startedAt`. Finalization records `finalizedAt` and, for every case the execution covers, a result and non-blank `actualResult` — there is no partial finalize — then appends immutable history per case.
- Per-case rules at finalization: a `Fail` requires a defect referencing that specific test case (an existing defect or one created in the same request); a `Blocked` requires a non-blank block reason for that case; a `Pass` must not create a defect for that case.
- The execution-level result is derived from the per-case results: `Fail` if any case failed, else `Blocked` if any case is blocked, else `Pass`.
- A defect requires test case, non-blank summary, status, priority, and severity. New defects may omit investigation owner and resolution summary; Triaged defects require priority and severity.
- Resolution requires non-blank resolution summary. Closure requires a non-blank retest evidence reference or closure rationale.
- A defect's Jira issue key is written by QAMS when it raises that issue and is never supplied, edited, or cleared by a person — the opposite of an execution's issue key, which is typed in while the run is Planned. No request accepts one, so there is no validation to fail; a defect that carries none simply has no issue yet.
- A defect owns at most one Jira issue, and an issue belongs to at most one defect. A second defect claiming an issue already bound to another is `ID_DUPLICATE`. This is enforced in the database, not only in the service.
- Where the defect's product names a Jira project, raising a defect raises the Jira issue and every subsequent transition of that defect is reported on it. Neither is part of the defect's transaction: a Jira failure never fails the create or the transition, and never returns an error to the caller. The outcome is recorded against the defect and shown on its screen.
- A product's Jira project key is optional and is set in the Catalogue by a role that may administer the catalogue. It is letters and digits starting with a letter, at least two characters, and is stored upper-cased; anything else is `ID_INVALID` on `jiraProjectKey`. Blank and absent both mean the product raises no bugs — clearing the field is how that is switched off, and is never an error. Omitting the field from an update leaves it unchanged, so an edit that says nothing about Jira can never silently disconnect a product.

## Automation check rules

- A **check** is one automation spec's observation of one test case at one instant. It reports; it does not claim. Only a person finalizing an execution claims that a test case passed, and a check never becomes, creates, or alters an execution.
- Check outcomes are `Passed`, `Failed`, `Errored`, and `Skipped`. There is no `Blocked`: blocking is a person stating they could not proceed and requires a block reason, which no spec can supply. `Errored` is distinct from `Failed` — a failure is the software under test disagreeing with an expectation, an error is the spec never reaching one — and collapsing the two reports a broken spec as broken software.
- A check is never edited. It carries no business ID and no version, and is append-only on the same rule as execution history.
- QAMS stores no binding between a test case and the spec that checks it. A spec names the test case business ID it covers, in its test name or that test's class name; QAMS resolves that ID when results are ingested. An ID resolving to nothing is `REFERENCE_NOT_FOUND` on that row and a test naming none at all is reported as declaring no test case; neither creates a check, and neither stops the rest of the file being ingested.
- A test-case revision inherits no coverage from the case it revises. A revision states different expected behaviour, so a spec must be pointed at the revision deliberately. Nothing follows a revision automatically, because a check recorded against expectations nobody re-verified is worse than no check at all.
- Checks are ingested from a JUnit XML results file uploaded by a role that may administer the system. Ingestion validates and reports per row like any import, and creates, updates, or transitions nothing else — no test case, no execution, no defect.
- Re-uploading a results file produces new checks. There is no `SKIPPED_UNCHANGED` and no reconciliation path: a check is an observation of one instant and is never the same observation twice.
- A check never contributes to an execution's result, an RTM link, a release-readiness figure, or a dashboard count. See "Traceability and reporting rules".

## Traceability and reporting rules

- Every Approved test case must link to exactly one Requirement. A requirement can have multiple test cases.
- The system permits an RTM link without a defect; it does not infer that an unlinked requirement is covered.
- Dashboard calculations exclude Retired products and Retired test cases. Execution and defect metrics must state filters, numerator, denominator, and as-of time before being shown.
- No percentage, readiness threshold, or defect ageing target is defined by this knowledge base. Return `POLICY_NOT_DEFINED` rather than calculate or recommend one.
- Automation checks are excluded from every figure defined here. They are observations rather than decisions, and no readiness or coverage number counts one. A metric that reports checks is a new metric carrying its own stated filters, numerator, and denominator — never a changed number behind an existing label.

## Import rules

- Required source headers must exactly match the mapping in `excel-source-map.md` after normalized whitespace; unknown extra columns are reported but ignored.
- Blank source rows are ignored. Partially populated rows are rejected as `ROW_INCOMPLETE`.
- Imports stage all rows, validate references and duplicates, then commit each dependency-consistent batch atomically.
- Existing ID with identical normalized values is `SKIPPED_UNCHANGED`; existing ID with different values is `RECONCILIATION_REQUIRED` and cannot overwrite automatically.
- Import reports preserve source sheet, row, status, error code, and created/linked record ID.

## Audit rules

Audit events are required for role changes, configuration changes, imports, record creation, record updates, lifecycle transitions, and release-readiness decisions. The event records actor, entity, action, UTC timestamp, request ID, and a redacted before/after summary. Audit records and execution history are append-only.
