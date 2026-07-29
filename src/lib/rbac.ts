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
  canExecute: [
    QamsRole.QA_TESTER,
    QamsRole.QA_ENGINEER,
    QamsRole.SENIOR_QA_ENGINEER,
    QamsRole.QA_LEAD
  ]
} as const;
