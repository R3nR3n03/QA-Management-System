/**
 * The one place the acceptance database is named. Both the global setup (separate
 * process) and the per-file env setup import this, so they cannot disagree.
 *
 * Derived from DATABASE_URL with the database name swapped to `qams_test`, or taken
 * verbatim from TEST_DATABASE_URL when set. Deriving rather than hardcoding keeps
 * host/port/credentials in `.env` as the single source for connection details.
 */
export function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error("DATABASE_URL is not set; copy .env.example to .env first.");
  }
  const url = new URL(base);
  url.pathname = "/qams_test";
  return url.toString();
}
