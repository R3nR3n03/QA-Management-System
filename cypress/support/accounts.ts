/**
 * The seeded accounts, named once for both sides of the suite.
 *
 * Imported by `cypress/tasks/seed-e2e.ts`, which creates these rows in Node, and by
 * `cypress/support/commands.ts`, which signs in as them in the browser. One module because the
 * two must agree exactly: a password that matched in only one place would fail as "rejected
 * credentials", which looks like a broken login rather than a broken fixture.
 *
 * **No imports, ever.** This is pulled into the browser bundle, so anything it required would go
 * with it — Prisma above all. That is the reason the constants live here rather than in the seed
 * script that owns the rows.
 *
 * Not read from the environment either. Cypress 15 deprecates `Cypress.env()` for exactly this
 * kind of value ("This allows any browser code to read values from Cypress.env()"), and there is
 * nothing to protect: the accounts exist only in a database whose name must end `_test`, which
 * `seed-e2e.ts` refuses to start without. A literal that cannot reach a real deployment is safer
 * than a variable that could be pointed at one.
 */

/** Test-fixture credential. Only ever valid against the truncatable `qams_test` database. */
export const E2E_PASSWORD = "e2e-only-not-a-real-secret";

export const ACCOUNTS = {
  QA_LEAD: { email: "lead@qams.e2e", displayName: "Priya Raman" },
  SENIOR_QA_ENGINEER: { email: "senior@qams.e2e", displayName: "Rani Okafor" },
  QA_ENGINEER: { email: "engineer@qams.e2e", displayName: "Dela Santos" },
  QA_TESTER: { email: "tester@qams.e2e", displayName: "Tomas Lindqvist" }
} as const;

export type E2ERole = keyof typeof ACCOUNTS;

/**
 * Where `seed-e2e.ts` writes what it created, relative to `cypress/`, and where the `db:seeded`
 * task reads it from. Named here so the writer and the reader cannot disagree.
 */
export const SEED_FILE = ".seed.json";

/** What a spec is handed by `cy.seeded()` — the ids `seed-e2e.ts` wrote. */
export type SeededData = {
  database: string;
  users: Array<{ email: string; role: string; displayName: string }>;
  approvedCase: { id: string; businessId: string };
  inReviewCase: { id: string; businessId: string };
  /** IN_REVIEW and authored by the SENIOR — the only case a reviewer can be the author of. */
  seniorAuthoredCase: { id: string; businessId: string };
};
