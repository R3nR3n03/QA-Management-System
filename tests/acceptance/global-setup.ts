import "dotenv/config";
import { execSync } from "node:child_process";
import { Client } from "pg";
import { testDatabaseUrl } from "./test-db-url";

/**
 * Runs once, in its own process, before any test file: creates the dedicated
 * `qams_test` database if it does not exist, then applies the committed migrations
 * with `prisma migrate deploy`.
 *
 * `migrate deploy`, NOT `db push`: migration 20260731110000 rewrites the RTM unique
 * index with `NULLS NOT DISTINCT`, which the Prisma schema cannot express — a pushed
 * schema would silently lack it and the RTM duplicate scenario would test the wrong
 * database.
 */
export default async function globalSetup() {
  const target = new URL(testDatabaseUrl());
  const dbName = target.pathname.replace(/^\//, "").split("?")[0];

  const admin = new URL(target.toString());
  admin.pathname = "/postgres";
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (exists.rowCount === 0) {
      await client.query(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await client.end();
  }

  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() }
  });
}
