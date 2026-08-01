-- Multi-test-case executions: one EXE-#### covers one or more Approved cases with
-- per-case results (`docs/data-model.md:25`, `docs/business-rules-and-validation.md:27-30`).
--
-- HAND-EDITED after generation: the generated script dropped the TestExecution columns
-- before the new table existed. Reordered so the backfill INSERT below copies every
-- existing execution's (testCaseId, result, actualResult, blockReason) into exactly one
-- ExecutionTestCase row BEFORE the columns are dropped — no data loss on migrate.

-- CreateTable
CREATE TABLE "ExecutionTestCase" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "testCaseId" TEXT NOT NULL,
    "result" "ExecutionOutcome",
    "actualResult" TEXT,
    "blockReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "ExecutionTestCase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionTestCase_executionId_testCaseId_key" ON "ExecutionTestCase"("executionId", "testCaseId");

-- AddForeignKey
ALTER TABLE "ExecutionTestCase" ADD CONSTRAINT "ExecutionTestCase_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "TestExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionTestCase" ADD CONSTRAINT "ExecutionTestCase_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill (hand-written): one child row per existing execution, carrying the values the
-- dropped columns held. Audit stamps are copied from the parent so provenance survives.
INSERT INTO "ExecutionTestCase" ("id", "executionId", "testCaseId", "result", "actualResult", "blockReason", "createdAt", "createdBy", "updatedAt", "updatedBy")
SELECT gen_random_uuid(), e."id", e."testCaseId", e."result", e."actualResult", e."blockReason", e."createdAt", e."createdBy", e."updatedAt", e."updatedBy"
FROM "TestExecution" e;

-- DropForeignKey
ALTER TABLE "TestExecution" DROP CONSTRAINT "TestExecution_testCaseId_fkey";

-- AlterTable
ALTER TABLE "TestExecution" DROP COLUMN "actualResult",
DROP COLUMN "blockReason",
DROP COLUMN "testCaseId";
