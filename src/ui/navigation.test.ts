import { QamsRole } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { NAV, navFor, navGroupsFor, roleLabel } from "./navigation";

const hrefs = (role: QamsRole) => navFor(role).map((i) => i.href);

describe("navFor", () => {
  /**
   * The security property, restated 2026-08-10. It used to be "no administration item below
   * QA Lead", which the catalogue ratification made false — but the property that actually
   * matters is narrower and is asserted by name here, so widening one screen cannot quietly
   * widen the rest. roles-workflows.md:16-17 confines controlled values, users, import
   * reconciliation and release readiness to the QA Lead. Enforcement is server-side in the
   * domain services either way; this asserts the shell agrees with it.
   */
  const LEAD_ONLY_ADMIN = [
    "/admin/controlled-values",
    "/admin/users",
    "/admin/imports",
    "/admin/integrations",
    // Uploading automation check results is a QA Lead capability, on the same reasoning
    // as workbook imports: bulk data entering the system from a file. Reading a check is
    // NOT here, because it is not an administration screen — checks are shown on the test
    // case they reference, to every role that may view it.
    "/admin/checks",
    "/release-readiness"
  ];

  it("keeps every Lead-only administration screen out of every lower role's shell", () => {
    for (const role of [QamsRole.QA_TESTER, QamsRole.QA_ENGINEER, QamsRole.SENIOR_QA_ENGINEER]) {
      for (const href of LEAD_ONLY_ADMIN) {
        expect(hrefs(role)).not.toContain(href);
      }
    }
    // And the list above is the whole of Administration bar the catalogue — so a new
    // Lead-only screen added without being listed here fails this test rather than
    // silently escaping it.
    const adminHrefs = navFor(QamsRole.QA_LEAD)
      .filter((i) => i.group === "Administration")
      .map((i) => i.href);
    expect(adminHrefs.sort()).toEqual([...LEAD_ONLY_ADMIN, "/catalogue"].sort());
  });

  /**
   * The catalogue is the one administration screen an author may open (RATIFIED 2026-08-10):
   * requirements are `canWriteRequirements`, so a QA Engineer must be able to reach the screen
   * that creates one. A QA Tester authors nothing and still may not.
   *
   * The screen is mixed for an author — Product / Module / Feature CRUD stays `canAdmin` in
   * `src/domain/catalogue.ts` — and that split is the domain's to enforce, not the nav's.
   */
  it("opens the catalogue to authors, but not to a QA Tester", () => {
    expect(hrefs(QamsRole.QA_TESTER)).not.toContain("/catalogue");
    expect(hrefs(QamsRole.QA_ENGINEER)).toContain("/catalogue");
    expect(hrefs(QamsRole.SENIOR_QA_ENGINEER)).toContain("/catalogue");
    expect(hrefs(QamsRole.QA_LEAD)).toContain("/catalogue");
  });

  it("gives the QA Lead every item", () => {
    expect(navFor(QamsRole.QA_LEAD)).toHaveLength(NAV.length);
  });

  // roles-workflows.md:10 - a QA Tester cannot create or edit a Draft test case.
  it("does not offer drafts to a QA Tester", () => {
    expect(hrefs(QamsRole.QA_TESTER)).not.toContain("/my-work/drafts");
    expect(hrefs(QamsRole.QA_ENGINEER)).toContain("/my-work/drafts");
  });

  // roles-workflows.md:12 - review and approve is Senior QA Engineer and above.
  it("offers the review queue only to reviewers", () => {
    expect(hrefs(QamsRole.QA_TESTER)).not.toContain("/review");
    expect(hrefs(QamsRole.QA_ENGINEER)).not.toContain("/review");
    expect(hrefs(QamsRole.SENIOR_QA_ENGINEER)).toContain("/review");
    expect(hrefs(QamsRole.QA_LEAD)).toContain("/review");
  });

  // roles-workflows.md:9 - every role may view authorized QA records and dashboards.
  it("gives every role the record screens", () => {
    for (const role of Object.values(QamsRole)) {
      const records = navFor(role).filter((i) => i.group === "Records");
      expect(records.map((i) => i.href).sort()).toEqual(
        ["/dashboard", "/defects", "/executions", "/test-cases", "/traceability"].sort()
      );
    }
  });

  it("gives every role somewhere to land", () => {
    for (const role of Object.values(QamsRole)) {
      expect(navFor(role).length).toBeGreaterThan(0);
      expect(hrefs(role)).toContain("/my-work");
    }
  });

  it("permissions widen monotonically with seniority", () => {
    const tester = new Set(hrefs(QamsRole.QA_TESTER));
    const engineer = new Set(hrefs(QamsRole.QA_ENGINEER));
    const senior = new Set(hrefs(QamsRole.SENIOR_QA_ENGINEER));
    const lead = new Set(hrefs(QamsRole.QA_LEAD));
    for (const href of tester) expect(engineer.has(href)).toBe(true);
    for (const href of engineer) expect(senior.has(href)).toBe(true);
    for (const href of senior) expect(lead.has(href)).toBe(true);
  });
});

describe("navGroupsFor", () => {
  it("omits an empty group rather than rendering an empty heading", () => {
    const groups = navGroupsFor(QamsRole.QA_TESTER).map((g) => g.group);
    expect(groups).toEqual(["My work", "Records"]);
    expect(navGroupsFor(QamsRole.QA_LEAD).map((g) => g.group)).toEqual([
      "My work",
      "Records",
      "Administration"
    ]);
  });
});

describe("NAV metadata", () => {
  it("cites a basis for every item, so review can check it against docs/", () => {
    for (const item of NAV) {
      expect(item.basis.length).toBeGreaterThan(10);
    }
  });

  it("has unique hrefs", () => {
    const seen = NAV.map((i) => i.href);
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe("roleLabel", () => {
  it("labels every role in the enum", () => {
    for (const role of Object.values(QamsRole)) {
      expect(roleLabel(role)).toMatch(/^QA |^Senior /);
    }
  });
});
