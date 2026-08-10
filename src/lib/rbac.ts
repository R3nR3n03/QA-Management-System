import { QamsRole } from "@prisma/client";
import { AppError } from "./errors";

export function ensureRole(allowed: QamsRole[], role: QamsRole) {
  if (!allowed.includes(role)) {
    throw new AppError(403, "UNAUTHORIZED", "You are not authorized to perform this action.");
  }
}

export const RoleSets = {
  canAuthor: [QamsRole.QA_ENGINEER, QamsRole.SENIOR_QA_ENGINEER, QamsRole.QA_LEAD],
  canApprove: [QamsRole.SENIOR_QA_ENGINEER, QamsRole.QA_LEAD],
  canTriageDefect: [QamsRole.QA_ENGINEER, QamsRole.SENIOR_QA_ENGINEER, QamsRole.QA_LEAD],
  canAdvanceDefect: [QamsRole.SENIOR_QA_ENGINEER, QamsRole.QA_LEAD],
  canAdmin: [QamsRole.QA_LEAD],
  /**
   * Create and edit Requirements.
   *
   * RATIFIED 2026-08-10 by the QA Lead, and recorded as a new row in the capability matrix
   * (`docs/roles-workflows.md`). Requirement CRUD used to sit behind `canAdmin` along with
   * the other three catalogue levels, which was invented policy — the matrix had no
   * catalogue row at all (the note in `src/ui/navigation.ts` says so and escalates it).
   *
   * Requirements only. Product, Module and Feature stay `canAdmin`, because the split is
   * structure versus content: the Lead owns the shape of the system under test, authors write
   * what is tested against it. Same shape as "Create or edit Draft test case and steps",
   * which is why this is the `canAuthor` set rather than a wider one — and deliberately NOT
   * an alias of `canAuthor`, so widening test-case authoring later cannot silently widen who
   * may rewrite the requirements that approval depends on.
   */
  canWriteRequirements: [QamsRole.QA_ENGINEER, QamsRole.SENIOR_QA_ENGINEER, QamsRole.QA_LEAD],
  canExecute: [
    QamsRole.QA_TESTER,
    QamsRole.QA_ENGINEER,
    QamsRole.SENIOR_QA_ENGINEER,
    QamsRole.QA_LEAD
  ]
} as const;
