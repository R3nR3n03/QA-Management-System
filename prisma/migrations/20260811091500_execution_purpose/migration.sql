-- An execution's purpose: what the run exists to check, in one line
-- (`docs/business-rules-and-validation.md`, `docs/data-model.md`). Required, so this lands
-- as NOT NULL -- but existing runs have nothing to put in it, hence the three steps.
--
-- HAND-WRITTEN, in the order add-nullable -> backfill -> constrain. Adding the column NOT
-- NULL in one statement would fail on any database that already holds an execution.
--
-- The backfill copies the FIRST covered case's title, which is exactly what those rows
-- already display as their headline today (`src/ui/record-list.tsx`, `caseTitle`), so the
-- migration changes nothing a reader sees for historical data. "First" is defined here the
-- same way the screens define it -- `CASES_INCLUDE` orders covered cases by `createdAt` asc
-- -- with `id` as the tie-break, because every case of one run is created inside a single
-- transaction and so routinely shares a timestamp. Without the tie-break the backfill would
-- not be deterministic.
--
-- Truncated to 120 characters because that is the documented cap: a backfilled row that
-- broke the rule could never be saved again from the edit form. `NULLIF`/`COALESCE` fall
-- back to the business ID for a blank title, and for the run with no covered cases that the
-- domain does not permit and the database has never been asked to forbid.

-- AlterTable
ALTER TABLE "TestExecution" ADD COLUMN "purpose" TEXT;

-- Backfill (hand-written)
UPDATE "TestExecution" e
SET "purpose" = COALESCE(
  NULLIF(
    TRIM(
      LEFT(
        (
          SELECT tc."title"
          FROM "ExecutionTestCase" covered
          JOIN "TestCase" tc ON tc."id" = covered."testCaseId"
          WHERE covered."executionId" = e."id"
          ORDER BY covered."createdAt" ASC, covered."id" ASC
          LIMIT 1
        ),
        120
      )
    ),
    ''
  ),
  e."businessId"
);

-- AlterTable
ALTER TABLE "TestExecution" ALTER COLUMN "purpose" SET NOT NULL;
