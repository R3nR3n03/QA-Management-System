/**
 * Points this process at the browser suite's database, and must be the FIRST import of anything
 * that runs against it.
 *
 * `src/lib/db.ts` builds its PrismaPg adapter from `DATABASE_URL` at module scope, so the swap has
 * to land before the first `@/lib/db` import — otherwise the domain services would write to the
 * development database. Imports are evaluated in source order, which is what makes an
 * import-for-side-effect the reliable way to do this; `tests/acceptance/setup-env.ts` is the same
 * file for the same reason, and vitest gives it the same guarantee through `setupFiles`.
 *
 * The database name itself comes from `tests/acceptance/test-db-url.ts`, so the browser suite and
 * the acceptance suite cannot end up on different databases.
 */

import "dotenv/config";
import { testDatabaseUrl } from "../../tests/acceptance/test-db-url";

process.env.DATABASE_URL = testDatabaseUrl();
