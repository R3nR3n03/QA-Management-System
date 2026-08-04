# Roles and Workflows

## Role model

Users hold exactly one active role in version 1. The application enforces every permission server-side.

| Capability | QA Tester | QA Engineer | Senior QA Engineer | QA Lead |
| --- | --- | --- | --- | --- |
| View authorized QA records and dashboards | Yes | Yes | Yes | Yes |
| Create or edit Draft test case and steps | No | Yes | Yes | Yes |
| Submit a test case for review | No | Yes, own cases | Yes | Yes |
| Review and approve test cases | No | No | Yes, not own case | Yes |
| Plan/start/finalize assigned execution | Yes | Yes | Yes | Yes |
| Create and update defect through Triaged | Yes | Yes | Yes | Yes |
| Move a defect to In Progress/Resolved/Closed | No | No | Yes | Yes |
| Manage controlled values, users, and import reconciliation | No | No | No | Yes |
| Make release-readiness decision | No | No | No | Yes |

QA Tester may create a defect while finalizing a failed execution but cannot approve a test case. Senior QA Engineer cannot approve a test case they authored. QA Lead may perform all actions and owns exceptional reconciliation decisions.

User management by the QA Lead covers account creation, role changes, profile edits (display name and email), and deactivation/reactivation. Deactivation is the only removal path — no user account is ever deleted. Two guardrails apply to deactivation: a QA Lead cannot deactivate their own account, and the last active QA Lead cannot be deactivated (so lead-gated capabilities never become unreachable). Deactivating an account takes effect immediately and permanently invalidates sessions issued before the deactivation; reactivation permits sign-in again but does not resurrect those sessions. Controlled-value management covers adding a value to one of the three documented catalogues and deactivating/reactivating values; values are never renamed or deleted.

## Test-case lifecycle

| From | To | Authorized role | Required condition |
| --- | --- | --- | --- |
| Draft | In Review | QA Engineer (author), Senior QA Engineer, QA Lead | Required fields valid; at least one valid step |
| In Review | Approved | Senior QA Engineer (not author), QA Lead | Reviewer confirms design completeness |
| In Review | Draft | Senior QA Engineer, QA Lead | Review feedback recorded in audit reason |
| Approved | Retired | Senior QA Engineer, QA Lead | Retirement reason recorded; case preserved |

Approved content is immutable. A material change requires a new Draft revision linked to the prior test case; retiring the prior revision is optional and must not break historical references.

**Seed-import exception.** Test cases created by the one-time workbook seed import enter the system as Approved without passing through Draft → In Review, because the workbook predates this workflow and its Test Execution and Execution History sheets can only be imported against Approved cases. The importing QA Lead is recorded as author. Each affected row's import report carries the note "Imported as Approved.", and the run report records the policy as a whole. Reconciliation-required import rows also retain the proposed workbook values in structured form so the QA Lead can resolve them later. This exception applies to the seed import only; no interactive path may create a test case in any state other than Draft.

## Execution lifecycle

| From | To | Authorized role | Required condition |
| --- | --- | --- | --- |
| Planned | In Progress | Assigned Tester, QA Engineer, Senior QA Engineer, QA Lead | Every referenced case is Approved; tester is assigned |
| In Progress | Finalized | Assigned Tester, QA Engineer, Senior QA Engineer, QA Lead | Every covered case has a result and actual result — no partial finalize; finalization timestamp supplied; each failed case meets the per-case defect rule and each blocked case has a block reason |

An execution covers one or more Approved test cases selected together at planning. Each covered case may have result `Pass`, `Fail`, or `Blocked` only at Finalized; the execution-level result is derived from the per-case results (`Fail` if any case failed, else `Blocked` if any case is blocked, else `Pass`). A finalized execution cannot return to In Progress. A rerun creates a new execution covering only the failed/blocked case(s) of the original.

While an execution is Planned, any role that may plan executions may reassign it to a different active tester; the reassignment is audited. Once an execution leaves Planned, its tester is part of the record and cannot be changed.

## Defect lifecycle

| From | To | Authorized role | Required condition |
| --- | --- | --- | --- |
| New | Triaged | QA Engineer, Senior QA Engineer, QA Lead | Priority, severity, and test case are valid |
| Triaged | In Progress | Senior QA Engineer, QA Lead | Investigation owner assigned |
| In Progress | Resolved | Senior QA Engineer, QA Lead | Resolution summary recorded |
| Resolved | Closed | Senior QA Engineer, QA Lead | Retest evidence or documented closure rationale recorded |
| Resolved | In Progress | Senior QA Engineer, QA Lead | Reopen reason recorded |

Any role with defect-edit permission may create a New defect or add factual reproduction detail before triage. No role may skip a state, delete a defect, or close a defect directly from New/Triaged/In Progress.

## Release readiness workflow

1. QA Lead selects the product, release, environment, and approved test-case scope.
2. The system reports finalized execution counts by result, open defect counts by severity, and requirements without trace links.
3. QA Lead records a readiness decision, rationale, timestamp, and source snapshot identifiers in an audit event.
4. This knowledge base does not define pass-rate thresholds or defect-severity release gates. The QA Lead must not infer them; record the organization-approved criteria in a future policy revision before applying them automatically.
