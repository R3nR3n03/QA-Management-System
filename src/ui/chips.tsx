import { ExecutionLifecycleState, ExecutionOutcome, TestCaseLifecycleState } from "@prisma/client";

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

const TEST_CASE_STATE_LABEL: Record<TestCaseLifecycleState, string> = {
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

export function OutcomeChip({ outcome }: { outcome: ExecutionOutcome }) {
  const tone =
    outcome === ExecutionOutcome.PASS
      ? " state-pass"
      : outcome === ExecutionOutcome.FAIL
        ? " state-fail"
        : " state-blocked";
  return <span className={`state${tone}`}>{OUTCOME_LABEL[outcome]}</span>;
}
