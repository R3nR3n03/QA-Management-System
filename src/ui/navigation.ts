/**
 * Navigation derived from the role/capability matrix, not hand-drawn.
 *
 * `docs/excel-source-map.md:11` rules out the workbook's Home sheet as the model:
 * "Not imported; application navigation derives from authorized capabilities." So
 * this module reads the matrix in `docs/roles-workflows.md:7-17` and returns the
 * items a given role may actually reach. Two roles never see the same shell, and a
 * link a role cannot use is absent rather than present-and-rejecting.
 *
 * RATIFIED 2026-08-01: this item list is the screen inventory referenced by
 * `docs/architecture.md` § "Web interface". The matrix establishes *capabilities*;
 * the groupings and labels here are presentation. What is NEVER invented: which
 * role may reach which capability.
 *
 * Pure module - no imports from `./db`, no `next/*`. Unit-testable without a database.
 */

import { QamsRole } from "@prisma/client";

export type NavItem = {
  href: string;
  label: string;
  /** Sidebar grouping. Purely presentational. */
  group: "My work" | "Records" | "Administration";
  /** The roles that can reach this screen at all. */
  roles: readonly QamsRole[];
  /** The documented line this entry derives from, for review. */
  basis: string;
};

const EVERY_ROLE = [
  QamsRole.QA_TESTER,
  QamsRole.QA_ENGINEER,
  QamsRole.SENIOR_QA_ENGINEER,
  QamsRole.QA_LEAD
] as const;

const REVIEWERS = [QamsRole.SENIOR_QA_ENGINEER, QamsRole.QA_LEAD] as const;
const AUTHORS = [QamsRole.QA_ENGINEER, QamsRole.SENIOR_QA_ENGINEER, QamsRole.QA_LEAD] as const;
const LEAD_ONLY = [QamsRole.QA_LEAD] as const;

export const NAV: readonly NavItem[] = [
  {
    href: "/my-work",
    label: "My work",
    group: "My work",
    roles: EVERY_ROLE,
    basis: "roles-workflows.md:13 - every role plans/starts/finalizes assigned executions"
  },
  {
    href: "/my-work/drafts",
    label: "My drafts",
    group: "My work",
    roles: AUTHORS,
    basis: "roles-workflows.md:10 - create or edit Draft test case and steps"
  },
  {
    href: "/review",
    label: "Review queue",
    group: "My work",
    roles: REVIEWERS,
    basis: "roles-workflows.md:12 - review and approve test cases"
  },
  {
    href: "/account",
    label: "My account",
    group: "My work",
    roles: EVERY_ROLE,
    basis:
      "NOT IN THE MATRIX - self-service credential change, owner-approved 2026-08-01; every role manages only its own credential (api-and-security.md:9)"
  },
  {
    href: "/test-cases",
    label: "Test cases",
    group: "Records",
    roles: EVERY_ROLE,
    basis: "roles-workflows.md:9 - view authorized QA records"
  },
  {
    href: "/executions",
    label: "Executions",
    group: "Records",
    roles: EVERY_ROLE,
    basis: "roles-workflows.md:9"
  },
  {
    href: "/defects",
    label: "Defects",
    group: "Records",
    roles: EVERY_ROLE,
    basis: "roles-workflows.md:14 - create and update defect through Triaged"
  },
  {
    href: "/traceability",
    label: "Traceability",
    group: "Records",
    roles: EVERY_ROLE,
    basis: "roles-workflows.md:9"
  },
  {
    href: "/dashboard",
    label: "Dashboard",
    group: "Records",
    roles: EVERY_ROLE,
    basis: "roles-workflows.md:9 - view authorized QA records and dashboards"
  },
  {
    // NOTE for the QA Lead: the matrix has NO row for catalogue CRUD. The
    // implementation gates it to QA Lead (`src/domain/catalogue.ts` uses
    // RoleSets.canAdmin), which is a conservative choice but is invented policy -
    // see IMPLEMENTATION-AUDIT-2026-07-31.md section 6 note 1. The nav mirrors the code
    // rather than guessing differently; if the QA Lead widens it, change both.
    href: "/catalogue",
    label: "Catalogue",
    group: "Administration",
    roles: LEAD_ONLY,
    basis: "NOT IN THE MATRIX - mirrors src/domain/catalogue.ts RoleSets.canAdmin. Escalated."
  },
  {
    href: "/admin/controlled-values",
    label: "Controlled values",
    group: "Administration",
    roles: LEAD_ONLY,
    basis: "roles-workflows.md:16 - manage controlled values, users, and import reconciliation"
  },
  {
    href: "/admin/users",
    label: "People",
    group: "Administration",
    roles: LEAD_ONLY,
    basis: "roles-workflows.md:16"
  },
  {
    href: "/admin/imports",
    label: "Workbook imports",
    group: "Administration",
    roles: LEAD_ONLY,
    basis: "roles-workflows.md:16"
  },
  {
    href: "/release-readiness",
    label: "Release readiness",
    group: "Administration",
    roles: LEAD_ONLY,
    basis: "roles-workflows.md:17 - make release-readiness decision"
  }
];

export function navFor(role: QamsRole): NavItem[] {
  return NAV.filter((item) => item.roles.includes(role));
}

export function navGroupsFor(role: QamsRole): Array<{ group: NavItem["group"]; items: NavItem[] }> {
  const order: NavItem["group"][] = ["My work", "Records", "Administration"];
  return order
    .map((group) => ({ group, items: navFor(role).filter((i) => i.group === group) }))
    .filter((section) => section.items.length > 0);
}

/** Human label for a role, for the "signed in as" line. */
export function roleLabel(role: QamsRole): string {
  switch (role) {
    case QamsRole.QA_TESTER:
      return "QA Tester";
    case QamsRole.QA_ENGINEER:
      return "QA Engineer";
    case QamsRole.SENIOR_QA_ENGINEER:
      return "Senior QA Engineer";
    case QamsRole.QA_LEAD:
      return "QA Lead";
  }
}
