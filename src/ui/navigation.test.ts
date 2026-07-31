import { QamsRole } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { NAV, navFor, navGroupsFor, roleLabel } from "./navigation";

const hrefs = (role: QamsRole) => navFor(role).map((i) => i.href);

describe("navFor", () => {
  // The security property: administration screens must not appear for anyone but a
  // QA Lead. roles-workflows.md:16-17 confines controlled values, users, import
  // reconciliation and release readiness to that role. Enforcement is server-side
  // in the domain services either way - this asserts the shell agrees with it.
  it("shows no administration item to any role below QA Lead", () => {
    for (const role of [QamsRole.QA_TESTER, QamsRole.QA_ENGINEER, QamsRole.SENIOR_QA_ENGINEER]) {
      const admin = navFor(role).filter((i) => i.group === "Administration");
      expect(admin).toEqual([]);
    }
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
