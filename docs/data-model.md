# Data Model

## Common record convention

Every persisted entity has a UUID primary key, immutable business ID where applicable, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, and optimistic `version`. Business IDs are allocated by the system when the creating request does not supply one: each entity type sequences its own numbers, and generation skips numbers already occupied (for example by imported records); a supplied ID is validated for format and uniqueness exactly as before. Domain services write audit events separately. Timestamps are UTC ISO-8601. Users are referenced by internal user IDs, never free-text names after import reconciliation.

**"Timestamps are UTC ISO-8601" governs the record, not the presentation.** Every persisted instant is UTC and every machine-readable surface repeats it as UTC — the `/api/v1` responses, the `dateTime` attribute of a rendered `<time>` element, and audit events. What a *person* is shown is a separate question, answered by their own **display preferences**: a signed-in reader sees stamps on their **viewer zone** and on the 12- or 24-hour clock they chose. A stamp written for someone outside QAMS carries the deployment's **organization zone**, named, and is always 24-hour. None of these changes what is stored, and none is consulted by any query. `CONTEXT.md` defines the terms and [ADR-0007](adr/0007-a-zone-for-readers-and-a-zone-for-outsiders.md) records why they are separate.

## Core catalogue

| Entity | Business ID | Required attributes | Relationships |
| --- | --- | --- | --- |
| Product | `PROD###` | name, version, status, optional jiraProjectKey | has many modules; defects raised against its test cases become bugs in its Jira project |
| Module | `MOD###` | productId, name | belongs to product; has many features |
| Feature | `FEAT###` | moduleId, name | belongs to module; has many requirements |
| Requirement | `REQ###` | featureId, statement | belongs to feature; has many trace links |

Product status is imported as source data and must be a configured catalogue value. A hierarchy parent cannot be deleted while it has children; retirement is the only supported preservation path.

## Test design and execution

| Entity | Business ID | Required attributes | Relationships |
| --- | --- | --- | --- |
| Test case | `TC-<PRODUCT>-####` | hierarchy IDs, cycle, sprint, release, environment, priority, severity, title, objective, expectedResult, lifecycleState, optional revisesTestCaseId | has many ordered steps; covered by executions through execution test case links; traces to requirement; a Draft revision may reference the prior Approved test case it revises |
| Test step | none | testCaseId, sequence, action, expectedResult | unique `(testCaseId, sequence)` |
| Test execution | `EXE-####` | purpose, testerId, state, derived result when finalized, startedAt/finalizedAt as applicable, optional jiraIssueKey | covers one or more test cases through execution test case links; has many history events; may link defects; may reference one Jira issue |
| Jira sync attempt | none | executionId, jiraIssueKey, attemptedAt, outcome, failureReason when failed or skipped | append-only; belongs to execution |
| Jira comment attempt | none | executionId, jiraIssueKey, attemptedAt, outcome, Jira's comment id when posted, failureReason when failed | append-only; belongs to execution; separate from the sync attempt because a comment reports one run while a transition speaks for the whole issue key |
| Execution test case | none | executionId, testCaseId, per-case result/actualResult/blockReason when finalized | unique `(executionId, testCaseId)`; belongs to execution; references a test case |
| Execution history | none | executionId, testCaseId, result, occurredAt | append-only; belongs to execution |
| Automation check | none | testCaseId, checkBatchId, spec name, test name, checkedAt, outcome, failureReason when failed or errored | append-only; belongs to a check batch; references a test case |
| Check batch | none | sourceFileName, actorId, startedAt, completedAt, row report | append-only; has many automation checks. Carries no status: the batch and its checks commit together, so a batch row exists only for an ingestion that finished |
| Defect | `BUG-####` | testCaseId, summary, status, priority, severity, optional jiraIssueKey | may trace to a requirement and many executions; may own one Jira issue; has many Jira defect attempts |
| Jira defect attempt | none | defectId, action (create, comment, or transition), jiraIssueKey once one exists, attemptedAt, outcome, Jira's comment id when a comment posted, failureReason when failed or skipped | append-only; belongs to defect; one table for all three actions because each speaks for exactly one defect and they are read together as one timeline |
| RTM link | none | requirementId, testCaseId, optional defectId | unique `(requirementId, testCaseId, defectId)` |

Cycle, sprint, release, and environment are required text attributes in v1; this knowledge base defines no separate master entities for them. They are preserved from the workbook when present.

`purpose` is a required free-text attribute of an execution: one line stating what the run exists to check, at most 120 characters after trimming. It has no master entity and is deliberately not unique — a browser matrix, a rerun, and a regression pass are several runs that are expected to read alike — and it never identifies a run, which is what `EXE-####` is for. It is the headline an execution is listed under wherever runs are listed. It may be set or changed only while the execution is Planned, on the same rule as the tester and the Jira issue key, and it is never cleared. Executions that predate the attribute carry the first covered case's title, truncated to the limit. An imported execution takes the workbook's `Purpose` cell when it has one, and falls back to the covered case's title the same way when that cell is blank (`excel-source-map.md`).

`jiraIssueKey` is optional and free of any master entity here: it names a record in Jira, not in QAMS. It matches `^[A-Z][A-Z0-9]+-[0-9]+$`, and QAMS validates only that shape — an issue key that is well formed but absent from Jira is accepted, and surfaces as a failed sync attempt rather than a rejected execution. Many executions may carry the same key; it is deliberately not unique. It may be set or changed only while the execution is Planned, and is part of the record once the execution leaves Planned, on the same rule as the tester in `roles-workflows.md`.

A sync attempt and a comment attempt are separate records, not one record with a kind. A transition is decided across every execution sharing an issue key and may be retried until it is abandoned; a result comment belongs to exactly one run and is attempted once. Keeping them apart is what stops a comment's outcome from being read as a transition's, in either direction.

An automation check and an execution are separate records, and neither is derived from the other. An execution is a person's claim that they ran a test case and what they found; a check is a machine's report of what a spec observed. They are kept apart so that a reader can always tell which of the two produced a result, and because one shared record would have to carry a nullable tester, an actual result nobody wrote, and a per-case failure rule that applied to only half its rows. The outcomes differ for the same reason: `Errored` and `Skipped` are states an execution has never had, and `Blocked` is a state a spec can never reach. See [ADR-0008](adr/0008-a-check-reports-an-execution-claims.md).

A check names the spec and the test within it that produced the observation. That name is the only thread from a failed check back to the code behind it, because QAMS stores no standing link between a test case and any spec — see [ADR-0009](adr/0009-a-spec-declares-its-own-coverage.md).

In a generated test-case ID the `<PRODUCT>` tag is the owning product's business ID, and generated test-case numbers are sequenced per product (`TC-PROD001-0001`, `TC-PROD001-0002`, …). Generated execution and defect IDs sequence across their whole entity type. The four-digit number space is a documented limit; allocation past `9999` is refused.

## Identity, configuration, and audit

| Entity | Required attributes | Constraints |
| --- | --- | --- |
| User | email, displayName, passwordHash, role, active, optional timeZone, optional hourFormat | one active QAMS role per user in v1; passwordHash is never returned by the API or written to audit logs; setting `active` false is the only removal path — no user record is ever deleted, so audit actors and `createdBy`/`updatedBy` references stay resolvable forever; `timeZone` and `hourFormat` are the person's own **display preferences**, set by themselves and by nobody else — `timeZone` is an IANA name, `hourFormat` is a 12- or 24-hour clock, and absent means they have never chosen, which for the zone is not the same as having chosen the organization's |
| Controlled value | catalogue, value, active | unique `(catalogue, value)` |
| Jira credential | userId, encrypted refresh token, connectedAt | at most one per user; token material is never returned by the API, rendered in a screen, or written to an audit event; revocable by its owner at any time |
| Audit event | occurredAt, actorId, action, entityType, entityId, before/after summary, requestId | append-only |
| Import run | source file metadata, actorId, startedAt, status, report | immutable completion report |

Controlled catalogues initially contain the workbook values for priority, severity, and execution result. The application also owns lifecycle values defined in `roles-workflows.md`; they are not editable configuration in v1.

## Relationship invariants

- A test case’s Product, Module, Feature, and Requirement must form one valid parent chain.
- Each test case must have at least one test step before review submission; its steps have consecutive positive sequence numbers beginning at 1.
- Every execution covers one or more Approved test cases through its execution test case links. An execution history row references a test case belonging to its execution. The execution-level result is derived from the per-case results: `Fail` if any case failed, else `Blocked` if any case is blocked, else `Pass`.
- A defect must reference a test case. A trace link’s requirement and test case must be hierarchy-consistent; a linked defect must reference that test case.
- History and audit data are immutable. Corrections create a new event or execution, never overwrite a finalized outcome.
- An automation check references exactly one test case, resolved at ingestion from the business ID its spec declared. QAMS stores no standing link between a test case and a spec, so a test-case revision inherits no coverage from the case it revises.
- Automation checks are append-only and belong to the check batch that ingested them. Re-uploading a results file adds checks rather than replacing them; a check is never edited and never deleted.
- An automation check never contributes to an execution's result, a trace link, a release-readiness figure, or a dashboard count. Checks and executions are separate records, and no figure defined in `business-rules-and-validation.md` counts a check.
- A Jira issue is transitioned only when every execution carrying its issue key is Finalized and every one of them derived `Pass`. One Finalized execution is never on its own sufficient, because several executions may cover the same Jira issue. An issue already transitioned is transitioned again by a run that finalized after that transition and passed, and is not transitioned twice for the same set of runs.
- Jira sync attempts are append-only and belong to the execution that triggered them. A Finalized execution is immutable, so no sync outcome is ever recorded on the execution itself.
- A sync attempt may record that no call was made. A finalize that declines to transition an issue writes a skipped attempt carrying the reason, so a reader can tell a deliberate decision from a failure or from an integration that is not working. A skipped attempt is never retried and never settles an issue.
- A result comment is posted on every finalize of an execution carrying an issue key, whatever that execution derived — unlike the transition, which speaks for the key as a whole. Comment attempts are append-only and belong to the execution, on the same rule as sync attempts.
- A defect's `jiraIssueKey` is unique: one defect owns one Jira issue, and no two defects may point at the same one. It is written by QAMS when it raises that issue and is never entered by a person, which is the opposite of an execution's key. It is absent whenever no issue has been raised — the integration is off, the deployment names no defect project, or every attempt so far has failed.
- Raising a defect raises a Jira issue in the Jira project named on the product the defect belongs to, reached through its test case. A product whose `jiraProjectKey` is unset raises nothing, which is the default for every product and is what keeps the defect sync off. Two products may name the same project; the key is deliberately not unique.
- `Product.jiraProjectKey` is catalogue data maintained by a QA Lead, not deployment configuration, and it is not a secret. QAMS validates only its shape — a well-formed key naming a project that does not exist in Jira is accepted, and surfaces later as a failed create attempt rather than a rejected product edit, so a Jira outage can never block catalogue editing.
- Every issue QAMS raises carries a label derived from the defect's business ID, and a create adopts an issue already carrying that label rather than raising a second one.
- A defect's Jira issue is transitioned only when the defect reaches Closed. Resolved is never sufficient, because closure is the step that requires retest evidence or a closure rationale and a defect may return from Resolved to In Progress. Reopening a defect never reopens its issue.
- Jira defect attempts are append-only and belong to the defect that triggered them. A create attempt may carry no issue key, because a create that failed never produced one; that row is the entire record that QAMS tried and could not.
- A defect attempt may record that no call was made. A transition attempt evaluated when the defect is no longer Closed writes a skipped attempt carrying the reason, on the same rule as an execution's skipped sync attempt, and is never retried.

## Derived views

The dashboard derives `Products` as count of non-retired products and `Test Cases` as count of non-retired test cases. Additional metrics are allowed only after their formula, scope, and denominator are documented in `business-rules-and-validation.md`.
