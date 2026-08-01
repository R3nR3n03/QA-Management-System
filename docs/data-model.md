# Data Model

## Common record convention

Every persisted entity has a UUID primary key, immutable business ID where applicable, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, and optimistic `version`. Domain services write audit events separately. Timestamps are UTC ISO-8601. Users are referenced by internal user IDs, never free-text names after import reconciliation.

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
| Test execution | `EXE-####` | testerId, state, derived result when finalized, startedAt/finalizedAt as applicable | covers one or more test cases through execution test case links; has many history events; may link defects |
| Execution test case | none | executionId, testCaseId, per-case result/actualResult/blockReason when finalized | unique `(executionId, testCaseId)`; belongs to execution; references a test case |
| Execution history | none | executionId, testCaseId, result, occurredAt | append-only; belongs to execution |
| Defect | `BUG-####` | testCaseId, summary, status, priority, severity | may trace to a requirement and many executions |
| RTM link | none | requirementId, testCaseId, optional defectId | unique `(requirementId, testCaseId, defectId)` |

Cycle, sprint, release, and environment are required text attributes in v1; this knowledge base defines no separate master entities for them. They are preserved from the workbook when present.

## Identity, configuration, and audit

| Entity | Required attributes | Constraints |
| --- | --- | --- |
| User | email, displayName, passwordHash, role, active | one active QAMS role per user in v1; passwordHash is never returned by the API or written to audit logs; setting `active` false is the only removal path — no user record is ever deleted, so audit actors and `createdBy`/`updatedBy` references stay resolvable forever |
| Controlled value | catalogue, value, active | unique `(catalogue, value)` |
| Audit event | occurredAt, actorId, action, entityType, entityId, before/after summary, requestId | append-only |
| Import run | source file metadata, actorId, startedAt, status, report | immutable completion report |

Controlled catalogues initially contain the workbook values for priority, severity, and execution result. The application also owns lifecycle values defined in `roles-workflows.md`; they are not editable configuration in v1.

## Relationship invariants

- A test case’s Product, Module, Feature, and Requirement must form one valid parent chain.
- Each test case must have at least one test step before review submission; its steps have consecutive positive sequence numbers beginning at 1.
- Every execution covers one or more Approved test cases through its execution test case links. An execution history row references a test case belonging to its execution. The execution-level result is derived from the per-case results: `Fail` if any case failed, else `Blocked` if any case is blocked, else `Pass`.
- A defect must reference a test case. A trace link’s requirement and test case must be hierarchy-consistent; a linked defect must reference that test case.
- History and audit data are immutable. Corrections create a new event or execution, never overwrite a finalized outcome.

## Derived views

The dashboard derives `Products` as count of non-retired products and `Test Cases` as count of non-retired test cases. Additional metrics are allowed only after their formula, scope, and denominator are documented in `business-rules-and-validation.md`.
