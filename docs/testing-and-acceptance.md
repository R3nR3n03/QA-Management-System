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
| Execution | Start an assigned Approved case | State becomes In Progress and `startedAt` is set. |
| Execution | Finalize Fail without same-case defect | `422` with documented rule failure. |
| Execution | Finalize Blocked without block reason | `422` with documented rule failure. |
| Execution | Edit a Finalized execution | Rejected; history remains append-only. |
| Defects | Skip New/Triaged to Closed | Rejected; transition table enforced. |
| Traceability | Link hierarchy-mismatched requirement/test case | `422 HIERARCHY_MISMATCH`. |
| Reporting | Dashboard count | Counts non-retired persisted products and cases, not imported Excel formula output. |
| Security | Client submits a higher role | Effective role remains server-resolved; unauthorized action is `403`. |
| Audit | Import, transition, and role change | Each emits an append-only event with actor, action, timestamp, request ID. |

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
