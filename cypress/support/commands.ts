/// <reference types="cypress" />

import { ACCOUNTS, E2E_PASSWORD, type E2ERole, type SeededData } from "./accounts";

export { ACCOUNTS, E2E_PASSWORD };
export type { E2ERole, SeededData };

/**
 * Sign in as one of the seeded roles.
 *
 * ## Why this goes through the API and not the form
 *
 * Not for speed — for the login throttle. `POST /api/v1/auth/login` spends the per-email bucket on
 * every attempt, successes included (`src/app/api/v1/auth/login/route.ts`, step 2: "Every attempt
 * pays, win or lose"), and the default allowance is `RATE_LIMIT_AUTH_MAX=10` in a 15-minute
 * window. A suite that signed in through the form once per test would lock its own accounts out
 * partway through the run and then report *rejected credentials* for every screen after that —
 * a false failure that looks exactly like a real regression.
 *
 * So: `cy.session` with `cacheAcrossSpecs`, which reduces the whole run to roughly one sign-in per
 * role, plus whatever `login.cy.ts` deliberately spends proving the form itself works.
 *
 * The form is still tested. It is tested *once*, in the spec that is about the form, which is
 * where that coverage belongs — every other spec is about a screen behind it, and driving the
 * login UI forty times tests the same three inputs forty times.
 *
 * ## Why validate()
 *
 * A cached session outliving the rows it points at. The run is seeded once before Cypress starts,
 * so within a run the ids are stable — but a cached session survives *between* runs, and the seed
 * that begins the next one issues new user ids. Without `validate` the first spec of that run would
 * load a screen carrying a cookie for a user who no longer exists, silently land on `/login`, and
 * fail on a missing element rather than saying the session was dead.
 */
Cypress.Commands.add("loginAs", (role: E2ERole) => {
  const account = ACCOUNTS[role];

  cy.session(
    ["qams", role],
    () => {
      cy.request({
        method: "POST",
        url: "/api/v1/auth/login",
        body: { email: account.email, password: E2E_PASSWORD },
        failOnStatusCode: false
      }).then((response) => {
        /*
         * This is the suite's safety interlock, not just an assertion.
         *
         * The seed script guards the database it TRUNCATES, but nothing stops Cypress from
         * driving an application server pointed somewhere else — and the specs after this one
         * ingest results files and approve test cases. Run against a server on the development
         * database, they would do that to real records.
         *
         * The seeded accounts exist ONLY in `qams_test`, so a 403 here means the server under
         * test is reading a different database. Failing loudly with that sentence stops the run
         * before anything is written, and turns what is otherwise a baffling cascade of missing
         * elements into the one fact that explains it.
         */
        expect(
          response.status,
          `Could not sign in as ${account.email}.\n` +
            "That account exists only in the browser suite's database, so this almost certainly " +
            "means the server at " +
            Cypress.config("baseUrl") +
            " is pointed at a different one. Start it with DATABASE_URL set to the qams_test " +
            "database (docs/testing-and-acceptance.md), and re-run `npm run e2e:seed` if the " +
            "database has since been reset.\n" +
            "Nothing has been written — the suite stops here rather than risk acting on real records."
        ).to.eq(200);
      });
    },
    {
      cacheAcrossSpecs: true,
      validate() {
        /*
         * `GET /api/v1/test-cases` is the right probe because it is the only kind of endpoint that
         * answers the question asked: `withRoute` with NO role gate, so it returns 200 for every
         * authenticated role and 403 for a dead session. A role-gated endpoint would make a valid
         * QA Tester session look invalid.
         */
        cy.request({ url: "/api/v1/test-cases", failOnStatusCode: false })
          .its("status")
          .should("eq", 200);
      }
    }
  );
});

/**
 * The ids the run was seeded with.
 *
 * Reads, never writes: seeding happens once before Cypress starts (see `cypress.config.ts` on why
 * a task cannot spawn it). A spec therefore SHARES this database with every other spec in the run
 * and must not assume it is untouched — the one place that matters is
 * `admin-checks-ingest.cy.ts`, which is the only spec that writes check batches and says so.
 *
 * Wrapped rather than called as `cy.task("db:seeded")` directly so a spec reads as a sentence and
 * the returned shape is typed in one place.
 */
Cypress.Commands.add("seeded", () => {
  return cy.task<SeededData>("db:seeded");
});

/**
 * Wait until React has hydrated the element a spec is about to drive.
 *
 * ## Why a screen is not usable the moment it renders
 *
 * These screens are server-rendered and then hydrated, and in the window between the two the
 * page looks finished and behaves like a photograph of one. Two things go wrong there, both
 * silently, and both were found by this suite rather than reasoned about:
 *
 * - **Typing is discarded.** `lead@qams.e2e` arrived in the login box as `qams.e2e` — React
 *   attached partway through and reset the input to what it had rendered, which is empty. The
 *   browser then refused to submit an address with no `@` in it, and the failure read as
 *   rejected credentials.
 * - **A click can vanish.** Before hydration a form carries Next's progressive-enhancement
 *   markup (`action=""` plus `$ACTION_REF` inputs) and a submit would POST; after hydration
 *   React owns the submit and rewrites the attribute to `javascript:throw new Error('A React
 *   form was unexpectedly submitted…')`. A click that lands on the changeover produces no
 *   request at all — Approve was pressed, nothing happened, and the screen said nothing.
 *
 * Neither is a Cypress artifact. A person on a slow connection, or on a dev server where
 * hydration takes seconds, meets both; `autoFocus` on the login form actively invites the
 * first one. What the suite must not do is *hide* them behind a fixed wait and then claim the
 * screens work.
 *
 * ## How it knows
 *
 * React caches its fiber on each DOM node it hydrates, as a `__reactFiber$…` property. That is
 * an internal, deliberately: there is no public signal for "this element is now live", and the
 * alternatives are a fixed `cy.wait` (a guess that gets slower or flakier, never right) or
 * retrying the interaction until it takes (which hides how long a real person would wait). If a
 * future React renames it, this fails with the sentence below rather than going quiet.
 *
 * Checked on the element itself rather than the page root, because hydration is not one moment:
 * the rail can be live while the form a spec is about to submit is not.
 */
Cypress.Commands.add("hydrated", (selector: string) =>
  cy.get(selector).should(($element) => {
    const live = Object.keys($element[0]).some((key) => key.startsWith("__reactFiber$"));
    expect(live, `React has hydrated ${selector} and will handle what a person does to it`).to.eq(
      true
    );
  })
);

declare global {
  namespace Cypress {
    interface Chainable {
      /** Sign in as a seeded role, reusing one cached session for the whole run. */
      loginAs(role: E2ERole): Chainable<void>;
      /** The ids this run was seeded with, read from `cypress/.seed.json`. */
      seeded(): Chainable<SeededData>;
      /** Wait for React to hydrate an element, then yield it — drive it only after this. */
      hydrated(selector: string): Chainable<JQuery<HTMLElement>>;
    }
  }
}
