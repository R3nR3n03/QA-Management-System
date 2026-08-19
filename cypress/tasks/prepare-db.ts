/**
 * Creates the test database if it is missing and applies the committed migrations, once, before
 * the browser suite runs.
 *
 * A four-line wrapper on purpose: the logic is `tests/acceptance/global-setup.ts`, which already
 * does exactly this for the DB-backed vitest suite, and the two must not drift. In particular it
 * runs `prisma migrate deploy` rather than `db push` — migration 20260731110000 rewrites the RTM
 * unique index with `NULLS NOT DISTINCT`, which the Prisma schema cannot express, so a pushed
 * schema would silently lack it. That reasoning belongs in one place and this is not it.
 *
 * A separate process rather than an import into `cypress.config.ts` so Cypress's config bundler
 * never has to take `pg` and `execSync` into its bundle.
 */

import globalSetup from "../../tests/acceptance/global-setup";

globalSetup()
  .then(() => {
    process.stdout.write("ok");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
