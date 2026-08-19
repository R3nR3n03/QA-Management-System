import { ACCOUNTS, E2E_PASSWORD } from "../support/accounts";

/**
 * The sign-in form itself — the one place the browser suite drives it, on purpose.
 *
 * Every other spec reaches its screen through `cy.loginAs`, which posts to the API and caches one
 * session per role for the whole run. That is not an optimisation: the login throttle charges its
 * per-email bucket on every attempt, successes included, with a default allowance of ten in
 * fifteen minutes (`src/app/api/v1/auth/login/route.ts`). Signing in through the form once per
 * test would exhaust it partway through a run, and every screen after that would fail reporting
 * rejected credentials — a false negative shaped exactly like a real regression.
 *
 * So the form's coverage lives here and is spent deliberately: two attempts, one of them against
 * an address that does not exist, so the failure path cannot consume a real account's allowance.
 */
describe("Signing in", () => {
  before(() => {
    // Only to fail loudly, with the sentence in `cypress.config.ts`, if the run was never seeded.
    cy.seeded();
  });

  beforeEach(() => {
    // No cy.loginAs here — this spec is about arriving unauthenticated.
    cy.clearCookies();
  });

  it("takes a signed-in person to their work", () => {
    cy.visit("/login");

    cy.contains("h1", "Sign in").should("be.visible");
    /*
     * Typed only once the box can keep it. The form accepts keystrokes before React hydrates and
     * discards them when it does — found here, as an address arriving without its first five
     * characters. See `cy.hydrated`.
     */
    cy.hydrated('input[name="email"]').type(ACCOUNTS.QA_LEAD.email);
    cy.get('input[name="password"]').type(E2E_PASSWORD, { log: false });
    cy.contains("button", "Sign in").click();

    // The server action redirects rather than rendering, so the assertion is the destination.
    cy.location("pathname").should("eq", "/my-work");
    // The rail states who is signed in, which is the proof the session is really established
    // and not just that a redirect happened.
    cy.contains(ACCOUNTS.QA_LEAD.displayName).should("be.visible");
  });

  it("refuses an unknown account without saying which half was wrong", () => {
    cy.visit("/login");

    // Deliberately an address with no account. A wrong password against a REAL address would
    // spend that account's throttle allowance, and the seeded accounts are shared with every
    // other spec in the run.
    cy.hydrated('input[name="email"]').type("nobody@qams.e2e");
    cy.get('input[name="password"]').type("definitely-not-the-password", { log: false });
    cy.contains("button", "Sign in").click();

    /*
     * The form's own wording, which is deliberately NOT the API's "Invalid credentials":
     * `src/app/login/actions.ts` overrides the generic UNAUTHORIZED copy because at a sign-in
     * form the useful sentence is about the credentials rather than about roles. Asserting the
     * friendly copy is what pins that decision — the generic one passing here would be a
     * regression nobody else would catch.
     */
    cy.get('[role="alert"]').should("be.visible").and("contain.text", "don't match");
    // Still on the form, and no session was issued.
    cy.location("pathname").should("eq", "/login");
    cy.getCookie("qams_session").should("not.exist");
  });

  it("sends an unauthenticated visitor from a private screen to the form", () => {
    cy.visit("/test-cases", { failOnStatusCode: false });
    cy.location("pathname").should("eq", "/login");
  });
});
