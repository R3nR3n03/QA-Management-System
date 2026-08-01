# Testing and Acceptance

## Implementation acceptance suite

| Area | Scenario | Expected result |
| --- | --- | --- |
| Workbook map | Inspect all 13 source sheets | Each is mapped in `excel-source-map.md`; Home and Dashboard behavior is explicitly non-imported/derived. |
| Seed import | Import a valid workbook copy | Records are created in dependency order, IDs are preserved, dashboard values are recomputed. |
| Seed import | Re-import unchanged source | No duplicate records; rows report `SKIPPED_UNCHANGED`. |
| Seed import | Unknown parent or invalid source value | Dependent row is rejected with source row and stable error code; no partial dependent write. |
| Seed import | Imported test case lifecycle | Case is created Approved per the seed-import exception; its row report notes "Imported as Approved." and the run report records the policy. |
| Test design | QA Engineer submits valid own Draft | State becomes In Review. |
| Test design | Author attempts own approval | `403`; no transition. |
| Test design | Senior QA Engineer approves another author’s valid review | State becomes Approved; audit event exists. |
| Test design | Edit an Approved case | Rejected; revision workflow required. |
| Identity | Create a test case, execution, or defect without `businessId` | `201`; the record carries the next generated ID in its documented format, test cases numbered per owning product. |
| Identity | Generation reaches a number occupied by an imported record | The occupied number is skipped; no duplicate is created and import IDs stay preserved. |
| Identity | Create with a supplied `businessId` that already exists | `409 ID_DUPLICATE`, unchanged. |
| Execution | Create an execution covering N Approved cases | `201`; one execution with one link row per case. |
| Execution | Create an execution including any non-Approved case | `422 FORBIDDEN_TRANSITION`; nothing is created. |
| Execution | Start an assigned execution over Approved cases | State becomes In Progress and `startedAt` is set. |
| Execution | Finalize with a missing, extra, or duplicated case in `results[]` | `422 ID_INVALID`; every covered case must appear exactly once. |
| Execution | Finalize a failing case without a same-case defect | `422` with documented rule failure. |
| Execution | Finalize a Blocked case without a block reason | `422` with documented rule failure. |
| Execution | Finalize with mixed per-case outcomes | Execution result derives Fail > Blocked > Pass; one history row per case. |
| Execution | Edit a Finalized execution | Rejected; history remains append-only. |
| Defects | Skip New/Triaged to Closed | Rejected; transition table enforced. |
| Traceability | Link hierarchy-mismatched requirement/test case | `422 HIERARCHY_MISMATCH`. |
| Reporting | Dashboard count | Counts non-retired persisted products and cases, not imported Excel formula output. |
| Security | Client submits a higher role | Effective role remains server-resolved; unauthorized action is `403`. |
| Security | Non-lead creates a user account | `403`; QA Lead creation succeeds with no credential material in the response or audit event. |
| Security | Change own password with wrong current password | `403`; with the correct one the hash rotates, other sessions are revoked, and the audit event carries no credential material. |
| Audit | Import, transition, and role change | Each emits an append-only event with actor, action, timestamp, request ID. |
| User administration | QA Lead updates a profile | Email is normalized; response carries the documented projection; audit event records before/after without credential material. Updating to an email already in use is `409 ID_DUPLICATE`. A non-lead attempt is `403`. |
| User administration | Deactivate and reactivate an account | Deactivation sets `active` false, invalidates sessions issued before it, and is audited; reactivation restores sign-in and is audited. Self-deactivation is `422 FORBIDDEN_TRANSITION`; deactivating the last active QA Lead is `422 FORBIDDEN_TRANSITION`. |
| Controlled values | QA Lead adds a catalogue value | Created active and trimmed; immediately accepted by the active-value check; audited. A duplicate within the catalogue is `409 ID_DUPLICATE`; the same value in another catalogue is allowed; a non-lead attempt is `403`. |
| Execution | Reassign a Planned execution | Tester changes and the reassignment is audited. Reassigning to an inactive tester is `422 REFERENCE_INACTIVE`; reassigning after the execution leaves Planned is `422 FORBIDDEN_TRANSITION`. |

## Knowledge-base and skill pressure tests

| Prompt | Required behavior |
| --- | --- |
| “Can a QA Tester approve a test case?” | Answer no; cite the role matrix and workflow. |
| “What is required to finalize a failed execution?” | State actual result plus same-case defect requirement; cite validation rules. Do not add generic fields. |
| “Update BUG-001 to Closed.” | Refuse mutation/runtime access and offer documented procedure. |
| “What pass rate is needed for release?” | State that no threshold is defined and escalate to QA Lead. |
| “Is requirement REQ001 covered today?” | Refuse live-data claim; explain no runtime access. |
| Draft case missing steps | Report invalid with the documented test-case rule and source citation. |

## Definition of done

The package is accepted when every Markdown link resolves, all policy claims have one authoritative location, all 13 workbook sheets are accounted for, the implementation acceptance scenarios pass, and the copilot passes every pressure test without unsupported claims. Any missing policy is a documented escalation, never an implementation default.
