# Excel Source Map and Seed Import

## Source file

`Enterprise_QA_Test_Case_Management_Pro (1).xlsx` is a seed/reference workbook. It has no named ranges, data validations, hidden sheets, or workflow enforcement. Only the listed fields and the two dashboard formulas are source facts; lifecycle, authorization, and validation rules come from this knowledge base.

## Sheet-to-domain mapping

| Workbook sheet | Table | Imported fields | Notes |
| --- | --- | --- | --- |
| Home | None | Navigation labels | Not imported; application navigation derives from authorized capabilities. |
| Product Master | `products` | Product ID, Product, Version, Status | IDs are preserved. |
| Module Master | `modules` | Module ID, Product ID, Module | Product must exist first. |
| Feature Master | `features` | Feature ID, Module ID, Feature | Module must exist first. |
| Requirement Master | `requirements` | Requirement ID, Feature ID, Requirement | Feature must exist first. |
| Test Repository | `test_cases` | TC ID, hierarchy IDs, Cycle, Sprint, Release, Environment, Priority, Severity, Title, Objective, Expected Result, Execution Status | `Execution Status` seeds only a legacy summary; it does not create an execution. |
| Test Steps | `test_steps` | TC ID, Step, Action, Expected | Step order is numeric and unique within the case. |
| Test Execution | `test_executions` | Execution ID, TC ID, Tester, Result, Bug | Import after approved test cases; blank source rows create nothing. |
| Execution History | `execution_history` | Execution ID, TC ID, Result, Date | Import only for a matching execution. |
| Bug Tracker | `defects` | Bug ID, TC ID, Summary, Status | No severity/priority exists in this sheet; do not invent source values. |
| RTM | `requirement_trace_links` | Requirement ID, TC ID, Bug ID | Requirement and test case are required; defect is optional. |
| Dashboard | Derived view | Metric, Value; Products and Test Cases formulas | Recompute in the application; never import formula results. |
| Settings | `controlled_values` | Priority, Severity, Result | Seed the three visible value lists. |

## Import order and behavior

1. Validate file structure and headers before any write.
2. Import controlled values, then Products, Modules, Features, and Requirements.
3. Import test cases and their ordered steps.
4. Import executions, history, defects, then RTM links.
5. Recalculate dashboard metrics from persisted records.
6. Produce a row-level import report: source sheet/row, outcome, record ID, and error code.

The import is idempotent by source business ID: re-importing the same values performs no duplicate insert; changed values require a QA Lead-approved reconciliation. A row with an unknown parent, duplicate business ID, invalid controlled value, or malformed step number is rejected without partial dependent writes.

## Source-controlled values

The workbook seeds these initial values:

| Catalogue | Values |
| --- | --- |
| Priority | High, Medium, Low |
| Severity | Critical, Major, Minor |
| Result | Pass, Fail, Blocked |

`Not Executed` appears in the sample Test Repository row. It is a legacy source value only; the application uses the execution lifecycle and does not use it as an execution result.

## Explicitly unsupported source behavior

- The workbook does not define user accounts, roles, approvals, audit fields, defect transitions, evidence, release readiness, or API behavior.
- The workbook does not supply data-validation rules, so source cells are not proof that any arbitrary value is valid.
- The Dashboard formulas use `COUNTA` over rows 4–1000. The application instead counts active persisted records as defined in `business-rules-and-validation.md`.
