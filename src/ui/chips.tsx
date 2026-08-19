import {
  CheckOutcome,
  DefectLifecycleState,
  ExecutionLifecycleState,
  ExecutionOutcome,
  TestCaseLifecycleState
} from "@prisma/client";
import { CHECK_OUTCOME_LABEL, CHECK_OUTCOME_TONE } from "./check-outcome";

/**
 * State reads before text does. Each chip carries a colour AND a stripe AND a word,
 * so state survives greyscale printing and colour-blindness — never colour alone.
 *
 * Labels use the exact spelling in `docs/roles-workflows.md` ("In Review", not
 * "In review"): those words are the shared vocabulary between the docs, the copilot
 * and the people using the tool, so the UI must not paraphrase them.
 */

const EXECUTION_STATE_LABEL: Record<ExecutionLifecycleState, string> = {
  PLANNED: "Planned",
  IN_PROGRESS: "In Progress",
  FINALIZED: "Finalized"
};

/**
 * Exported because the test case's lifecycle rail names the same four states
 * (`test-cases/[id]/page.tsx`). Four strings restated there would be four chances for a rail
 * and the chip beside it to disagree about what `IN_REVIEW` is called.
 */
export const TEST_CASE_STATE_LABEL: Record<TestCaseLifecycleState, string> = {
  DRAFT: "Draft",
  IN_REVIEW: "In Review",
  APPROVED: "Approved",
  RETIRED: "Retired"
};

const OUTCOME_LABEL: Record<ExecutionOutcome, string> = {
  PASS: "Pass",
  FAIL: "Fail",
  BLOCKED: "Blocked"
};

export function ExecutionStateChip({ state }: { state: ExecutionLifecycleState }) {
  const tone = state === ExecutionLifecycleState.IN_PROGRESS ? " state-review" : "";
  return <span className={`state${tone}`}>{EXECUTION_STATE_LABEL[state]}</span>;
}

export function TestCaseStateChip({ state }: { state: TestCaseLifecycleState }) {
  const tone =
    state === TestCaseLifecycleState.APPROVED
      ? " state-pass"
      : state === TestCaseLifecycleState.IN_REVIEW
        ? " state-review"
        : "";
  return <span className={`state${tone}`}>{TEST_CASE_STATE_LABEL[state]}</span>;
}

const DEFECT_STATUS_LABEL: Record<DefectLifecycleState, string> = {
  NEW: "New",
  TRIAGED: "Triaged",
  IN_PROGRESS: "In Progress",
  RESOLVED: "Resolved",
  CLOSED: "Closed"
};

export function DefectStatusChip({ status }: { status: DefectLifecycleState }) {
  const tone =
    status === DefectLifecycleState.CLOSED
      ? " state-pass"
      : status === DefectLifecycleState.NEW
        ? " state-fail"
        : status === DefectLifecycleState.RESOLVED
          ? " state-review"
          : "";
  return <span className={`state${tone}`}>{DEFECT_STATUS_LABEL[status]}</span>;
}

export function OutcomeChip({ outcome }: { outcome: ExecutionOutcome }) {
  const tone =
    outcome === ExecutionOutcome.PASS
      ? " state-pass"
      : outcome === ExecutionOutcome.FAIL
        ? " state-fail"
        : " state-blocked";
  return <span className={`state${tone}`}>{OUTCOME_LABEL[outcome]}</span>;
}

/**
 * What one automation spec observed. Deliberately NOT `OutcomeChip`: that one reports what
 * a person claimed on finalizing a run, and these two must never be mistaken for each other
 * on a screen (ADR-0008) -- which is why the words differ too, "Failed" against "Fail".
 *
 * ERRORED does not get the failure tone. Keeping it apart from FAILED is the whole point:
 * a broken spec is not broken software, and rendering them alike would undo that at the one
 * place a person actually reads it.
 */
export function CheckOutcomeChip({ outcome }: { outcome: CheckOutcome }) {
  return <span className={CHECK_OUTCOME_TONE[outcome] ?? "state"}>{CHECK_OUTCOME_LABEL[outcome]}</span>;
}
