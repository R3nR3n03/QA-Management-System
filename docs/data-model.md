# Data Model

## Common record convention

Every persisted entity has a UUID primary key, immutable business ID where applicable, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, and optimistic `version`. Business IDs are allocated by the system when the creating request does not supply one: each entity type sequences its own numbers, and generation skips numbers already occupied (for example by imported records); a supplied ID is validated for format and uniqueness exactly as before. Domain services write audit events separately. Timestamps are UTC ISO-8601. Users are referenced by internal user IDs, never free-text names after import reconciliation.

## Core catalogue

| Entity | Business ID | Required attributes | Relationships |
| --- | --- | --- | --- |
| Product | `PROD###` | name, version, status | has many modules |
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
| Jira sync attempt | none | executionId, jiraIssueKey, attemptedAt, outcome, failureReason when failed | append-only; belongs to execution |
| Execution test case | none | executionId, testCaseId, per-case result/actualResult/blockReason when finalized | unique `(executionId, testCaseId)`; belongs to execution; references a test case |
| Execution history | none | executionId, testCaseId, result, occurredAt | append-only; belongs to execution |
| Defect | `BUG-####` | testCaseId, summary, status, priority, severity | may trace to a requirement and many executions |
| RTM link | none | requirementId, testCaseId, optional defectId | unique `(requirementId, testCaseId, defectId)` |

Cycle, sprint, release, and environment are required text attributes in v1; this knowledge base defines no separate master entities for them. They are preserved from the workbook when present.

`purpose` is a required free-text attribute of an execution: one line stating what the run exists to check, at most 120 characters after trimming. It has no master entity and is deliberately not unique — a browser matrix, a rerun, and a regression pass are several runs that are expected to read alike — and it never identifies a run, which is what `EXE-####` is for. It is the headline an execution is listed under wherever runs are listed. It may be set or changed only while the execution is Planned, on the same rule as the tester and the Jira issue key, and it is never cleared. Executions that predate the attribute carry the first covered case's title, truncated to the limit; imported executions take the covered case's title the same way, since the workbook has no column for it.

`jiraIssueKey` is optional and free of any master entity here: it names a record in Jira, not in QAMS. It matches `^[A-Z][A-Z0-9]+-[0-9]+$`, and QAMS validates only that shape — an issue key that is well formed but absent from Jira is accepted, and surfaces as a failed sync attempt rather than a rejected execution. Many executions may carry the same key; it is deliberately not unique. It may be set or changed only while the execution is Planned, and is part of the record once the execution leaves Planned, on the same rule as the tester in `roles-workflows.md`.

In a generated test-case ID the `<PRODUCT>` tag is the owning product's business ID, and generated test-case numbers are sequenced per product (`TC-PROD001-0001`, `TC-PROD001-0002`, …). Generated execution and defect IDs sequence across their whole entity type. The four-digit number space is a documented limit; allocation past `9999` is refused.

## Identity, configuration, and audit

| Entity | Required attributes | Constraints |
| --- | --- | --- |
| User | email, displayName, passwordHash, role, active | one active QAMS role per user in v1; passwordHash is never returned by the API or written to audit logs; setting `active` false is the only removal path — no user record is ever deleted, so audit actors and `createdBy`/`updatedBy` references stay resolvable forever |
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
- A Jira issue is transitioned only when every execution carrying its issue key is Finalized and every one of them derived `Pass`. One Finalized execution is never on its own sufficient, because several executions may cover the same Jira issue.
- Jira sync attempts are append-only and belong to the execution that triggered them. A Finalized execution is immutable, so no sync outcome is ever recorded on the execution itself.

## Derived views

The dashboard derives `Products` as count of non-retired products and `Test Cases` as count of non-retired test cases. Additional metrics are allowed only after their formula, scope, and denominator are documented in `business-rules-and-validation.md`.
