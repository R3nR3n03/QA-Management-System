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
| Update requests include the current optimistic `version`. | `VERSION_CONFLICT` |

## Test-case rules

- Required before review: Product ID, Module ID, Feature ID, Requirement ID, Cycle, Sprint, Release, Environment, Priority, Severity, Title, Objective, Expected Result, and one or more steps.
- `title`, `objective`, `expectedResult`, step `action`, and step `expectedResult` are non-blank after trimming.
- Step sequences are integers `1..n`, unique per test case, and contain no gap.
- Only a Draft case can be edited. Submission and approval enforce the role and transition table in `roles-workflows.md`.
- A case cannot be retired if it is Draft or In Review; resolve or reject the review first.

## Execution and defect rules

- An execution is created Planned for one or more Approved test cases and exactly one assigned tester.
- Start records `startedAt`. Finalization records `finalizedAt` and, for every case the execution covers, a result and non-blank `actualResult` — there is no partial finalize — then appends immutable history per case.
- Per-case rules at finalization: a `Fail` requires a defect referencing that specific test case (an existing defect or one created in the same request); a `Blocked` requires a non-blank block reason for that case; a `Pass` must not create a defect for that case.
- The execution-level result is derived from the per-case results: `Fail` if any case failed, else `Blocked` if any case is blocked, else `Pass`.
- A defect requires test case, non-blank summary, status, priority, and severity. New defects may omit investigation owner and resolution summary; Triaged defects require priority and severity.
- Resolution requires non-blank resolution summary. Closure requires a non-blank retest evidence reference or closure rationale.

## Traceability and reporting rules

- Every Approved test case must link to exactly one Requirement. A requirement can have multiple test cases.
- The system permits an RTM link without a defect; it does not infer that an unlinked requirement is covered.
- Dashboard calculations exclude Retired products and Retired test cases. Execution and defect metrics must state filters, numerator, denominator, and as-of time before being shown.
- No percentage, readiness threshold, or defect ageing target is defined by this knowledge base. Return `POLICY_NOT_DEFINED` rather than calculate or recommend one.

## Import rules

- Required source headers must exactly match the mapping in `excel-source-map.md` after normalized whitespace; unknown extra columns are reported but ignored.
- Blank source rows are ignored. Partially populated rows are rejected as `ROW_INCOMPLETE`.
- Imports stage all rows, validate references and duplicates, then commit each dependency-consistent batch atomically.
- Existing ID with identical normalized values is `SKIPPED_UNCHANGED`; existing ID with different values is `RECONCILIATION_REQUIRED` and cannot overwrite automatically.
- Import reports preserve source sheet, row, status, error code, and created/linked record ID.

## Audit rules

Audit events are required for role changes, configuration changes, imports, record creation, record updates, lifecycle transitions, and release-readiness decisions. The event records actor, entity, action, UTC timestamp, request ID, and a redacted before/after summary. Audit records and execution history are append-only.
