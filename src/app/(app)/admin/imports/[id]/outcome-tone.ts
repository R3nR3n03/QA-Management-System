/**
 * Import outcomes are informational, not lifecycle results: the Pass/Fail/Blocked
 * palette stays reserved for what policy grades (DESIGN-SYSTEM.md, principle 1).
 * Words carry the meaning; the accent tone marks outcomes that need a look.
 */
export const OUTCOME_TONE: Record<string, string> = {
  CREATED: "state state-accent",
  SKIPPED_UNCHANGED: "state",
  RECONCILIATION_REQUIRED: "state state-accent",
  REJECTED: "state"
};
