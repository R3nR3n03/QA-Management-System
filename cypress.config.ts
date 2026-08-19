import { readFileSync } from "node:fs";
import path from "node:path";
// Loads `.env`, so `CYPRESS_BASE_URL` can live there beside `DATABASE_URL`. Cypress does not
// read `.env` itself, unlike vitest, whose setup files import this (`tests/acceptance/setup-env.ts`).
import "dotenv/config";
import { defineConfig } from "cypress";
import { SEED_FILE } from "./cypress/support/accounts";

/**
 * The browser suite (`docs/testing-and-acceptance.md` § "Browser suite").
 *
 * Three gates now exist and they answer different questions. `npm run test` proves the units and
 * components in isolation with no database. `npm run test:acceptance` proves the domain services
 * against real PostgreSQL. This proves the part neither can reach: that a person driving a real
 * browser through the rendered screens gets the behaviour the other two assert — server actions
 * round-tripping, the session cookie, and RBAC deciding what is even on the page.
 *
 * It runs against the same dedicated `qams_test` database the acceptance suite uses, never the
 * development one, and `cypress/tasks/seed-e2e.ts` refuses to start against a database whose name
 * does not end `_test`.
 *
 * ## Why there are no child processes here
 *
 * The obvious shape — a `db:reset` task that shells out to the seed script — does not work on
 * Windows. A Node process spawned from Cypress's Electron parent dies the instant it loads a
 * module, with status 0xC0000409 (STACK_BUFFER_OVERRUN) and an empty stderr. Verified against a
 * relative path, an absolute path, an explicit cwd, `npx` and a direct `node` invocation, and with
 * `NODE_OPTIONS` cleared; a bare `node -v` is the only thing that survives, which is what rules out
 * path resolution as the cause.
 *
 * So the database work happens **before** Cypress starts, in npm's own shell where it demonstrably
 * works (`npm run test:e2e` chains it), and the only task here reads the JSON that produced. The
 * consequence is stated rather than hidden: one seeded database serves the whole run, so specs must
 * not depend on being handed a fresh one. See `docs/testing-and-acceptance.md`.
 *
 * ## Why the application is not started for you
 *
 * Cypress drives a browser at `baseUrl`; something has to be serving it, and that something must be
 * pointed at the test database or the suite seeds one database and reads another. That is a
 * deliberate two-terminal workflow rather than a `start-server-and-test` dependency, because the
 * server's `DATABASE_URL` is the part a person has to get right and hiding it in a script is how it
 * gets got wrong.
 */
export default defineConfig({
  /*
   * Cypress 15 warns that `Cypress.env()` lets any browser code read those values and that it will
   * be removed. Nothing here needs it — the fixture credentials are plain constants in
   * `cypress/support/accounts.ts` — so the capability is switched off rather than left on and
   * unused.
   */
  allowCypressEnv: false,
  /*
   * A desktop, because that is what these screens are drawn for.
   *
   * Cypress defaults to 1000x660, which is narrower than the layouts assume: `.checks-screen`
   * takes the 1440px opt-in and spends it on a full-width batch table (`DESIGN-SYSTEM.md`).
   * At the default the table's last column falls outside `.table-scroll` and its tallies are
   * clipped rather than absent — Cypress reports that as "not visible", correctly, and the spec
   * then fails on the viewport rather than on the product.
   *
   * Not a workaround for that failure: a suite driving screens at a width the design does not
   * target is asserting against a layout nobody uses. Responsive behaviour is a separate
   * question and this suite does not ask it.
   */
  viewportWidth: 1440,
  viewportHeight: 900,
  e2e: {
    baseUrl: process.env.CYPRESS_BASE_URL ?? "http://localhost:3000",
    supportFile: "cypress/support/e2e.ts",
    specPattern: "cypress/e2e/**/*.cy.ts",
    fixturesFolder: "cypress/fixtures",
    // Nothing here is a recording worth keeping, and the artifacts are gitignored anyway.
    video: false,
    screenshotOnRunFailure: true,
    /*
     * Retries are OFF, deliberately, and not on the usual "flake is a smell" grounds.
     *
     * Every sign-in charges the login throttle's per-email bucket whether it succeeds or fails
     * (`src/app/api/v1/auth/login/route.ts`, step 2 — "Every attempt pays, win or lose"), and the
     * default allowance is 10 in 15 minutes. A retried spec re-runs its `cy.session` setup, so
     * retries turn a slow afternoon into a locked-out account and a suite reporting rejected
     * credentials instead of the failure it actually hit. `cy.loginAs` caches across specs for the
     * same reason. Raise `RATE_LIMIT_AUTH_MAX` on the server under test before turning these on.
     */
    retries: 0,
    setupNodeEvents(on, config) {
      on("task", {
        /**
         * What `cypress/tasks/seed-e2e.ts` created, read off disk.
         *
         * `readFileSync` and nothing else — see the note above on why this cannot spawn the seed
         * itself. A missing file means the suite was started without seeding, which is worth an
         * explicit sentence: the alternative is every spec failing on `undefined.businessId`.
         */
        "db:seeded": () => {
          const file = path.join(config.projectRoot, "cypress", SEED_FILE);
          try {
            return JSON.parse(readFileSync(file, "utf8"));
          } catch {
            throw new Error(
              `No seed data at ${file}.\n` +
                "The browser suite does not seed itself — run `npm run test:e2e`, which seeds first, " +
                "or `npm run e2e:seed` before `npm run test:e2e:open`."
            );
          }
        }
      });
    }
  }
});
