import type { SeededData } from "../support/accounts";

/**
 * The rule that an author cannot approve their own test case
 * (`docs/roles-workflows.md`), as a reader actually meets it.
 *
 * The domain suite already proves `approveTestCase` throws for a self-approving author. What only
 * a browser can prove is the half that decides whether anyone ever hits that error: the control
 * is **not rendered** for the author, and the screen says why instead. A regression that left the
 * button on the page would still be caught by the service — as a 403 the author gets after
 * clicking a button the product offered them, which is a different and much worse product than
 * the one the policy describes.
 *
 * ## Two authors, because the screen refuses them differently
 *
 * "You authored this case" is a sentence for a REVIEWER. The whole Review section is gated on the
 * viewer being one (`mayReview` in `test-cases/[id]/page.tsx`), so the two authors this suite
 * seeds meet different screens, and both are the policy working:
 *
 * - the SENIOR who authored `seniorAuthoredCase` is offered the section and refused inside it,
 *   because they are exactly the person who would otherwise approve it;
 * - the QA ENGINEER who authored `inReviewCase` never sees the section at all, because a QA
 *   Engineer reviews nothing — being its author is not what stops them.
 *
 * Nothing here is arranged: the seed really does author each case as that person.
 */
describe("Approving a test case", () => {
  let seeded: SeededData;

  before(() => {
    cy.seeded().then((data) => {
      seeded = data;
    });
  });

  it("refuses the author of a case they would otherwise review, and says why", () => {
    cy.loginAs("SENIOR_QA_ENGINEER");
    cy.visit(`/test-cases/${seeded.seniorAuthoredCase.id}`);

    cy.contains(seeded.seniorAuthoredCase.businessId).should("be.visible");
    // Offered the section — this reviewer's own case is still theirs to send back.
    cy.contains("h2", "Review").should("be.visible");

    cy.contains("You authored this case").should("be.visible");
    // The refusal is inline on the record, never a tooltip and never a disabled button.
    cy.contains("button", "Approve").should("not.exist");
  });

  /*
   * Runs BEFORE the approval below, which moves this same case out of In Review. Stated because
   * the order is load-bearing rather than incidental: one seeded database serves the whole run.
   */
  it("offers an author who cannot review no review section at all", () => {
    cy.loginAs("QA_ENGINEER");
    cy.visit(`/test-cases/${seeded.inReviewCase.id}`);

    cy.contains(seeded.inReviewCase.businessId).should("be.visible");
    /*
     * Absent, not refused-inside. A QA Engineer is stopped by not being a reviewer, which is the
     * earlier and wider rule, so the screen owes them no sentence about authorship — offering the
     * section and then explaining it away would tell them the wrong thing about why.
     */
    cy.contains("h2", "Review").should("not.exist");
    cy.contains("button", "Approve").should("not.exist");
  });

  it("lets a different reviewer approve it", () => {
    cy.loginAs("SENIOR_QA_ENGINEER");
    cy.visit(`/test-cases/${seeded.inReviewCase.id}`);

    cy.contains("You authored this case").should("not.exist");
    // Pressed only once React owns the submit; a click before that produces no request at all.
    cy.hydrated("form").contains("button", "Approve").should("be.visible").click();

    // The state moved, and the screen now says approved content is immutable.
    cy.contains("h2", "Approved case").should("be.visible");
    cy.contains("Approved content is immutable").should("be.visible");
    // The control is spent: there is nothing left to approve.
    cy.contains("button", "Approve").should("not.exist");
  });

  it("does not offer review to a role that cannot review", () => {
    /*
     * A QA Tester may VIEW a case but not review one. The Review section is therefore absent
     * rather than present-and-refusing — `mayReview` gates the whole block in `page.tsx`, and
     * the distinction is the same one the checks screen makes with `notFound()`.
     */
    cy.loginAs("QA_TESTER");
    cy.visit(`/test-cases/${seeded.approvedCase.id}`);

    cy.contains(seeded.approvedCase.businessId).should("be.visible");
    cy.contains("h2", "Review").should("not.exist");
    cy.contains("button", "Approve").should("not.exist");
  });
});
