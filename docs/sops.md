# Standard Operating Procedures

## SOP-01: Author and approve a test case

1. QA Engineer selects the valid Product → Module → Feature → Requirement chain.
2. Enter cycle, sprint, release, environment, active priority and severity, title, objective, expected result, and consecutive ordered steps.
3. Validate the Draft against the test-case rules; correct all errors before submission.
4. Submit the case to In Review.
5. A Senior QA Engineer other than the author, or the QA Lead, either returns it to Draft with audit reason or approves it.
6. Execute only the Approved case. Revise through a new Draft revision, never by editing the approved record.

## SOP-02: Execute a test case

1. Confirm the assigned test case is Approved and the target environment/build is the intended one.
2. Start the Planned execution; this records start time.
3. Perform each ordered step and retain factual actual-result notes.
4. Finalize as Pass, Fail, or Blocked with actual result.
5. For Fail, link an existing same-case defect or create a New defect. For Blocked, record the block reason.
6. Verify the history entry; never edit a Finalized execution. Create a new execution for reruns.

## SOP-03: Log, triage, and close a defect

1. Create a New defect with the affected test case, concise factual summary, priority, and severity.
2. QA Engineer, Senior QA Engineer, or QA Lead triages it after confirming the test case link and controlled values.
3. Senior QA Engineer or QA Lead assigns investigation and advances it through the permitted states.
4. Record a resolution summary before Resolved.
5. Close only after retest evidence reference or a documented closure rationale; reopen only with a recorded reason.

## SOP-04: Maintain traceability

1. Link each test case to its one Requirement when the case is drafted.
2. Link a defect to the same test case before adding it to the RTM.
3. Review RTM for requirements lacking trace links before release readiness.
4. Do not claim coverage from a requirement name, a dashboard count, or a legacy source value alone.

## SOP-05: Import the seed workbook

1. QA Lead selects the approved source workbook and starts the import.
2. Review the pre-commit validation report by sheet and row.
3. Correct rejected source data or explicitly reconcile changed existing IDs; do not force overwrite.
4. Commit validated dependency batches, then verify products, cases, steps, and dashboard totals.
5. Retain the immutable Import Run report and audit record.

## SOP-06: Assess release readiness

1. QA Lead selects product, release, environment, and test-case scope.
2. Review derived finalized outcomes, unresolved defects by severity, and requirements without links.
3. Apply only organization-approved release criteria that have been added to this knowledge base.
4. Record decision and rationale. If criteria are absent, record that readiness is advisory and escalate instead of applying an invented threshold.
