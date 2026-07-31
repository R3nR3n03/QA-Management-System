import "dotenv/config";
import { testDatabaseUrl } from "./test-db-url";

// Must run before any test file module loads: `src/lib/db.ts` constructs its
// PrismaPg adapter from DATABASE_URL at module scope, so the swap to the dedicated
// test database has to happen before the first `@/lib/db` import, or the domain
// services under test would run against the development database.
process.env.DATABASE_URL = testDatabaseUrl();
