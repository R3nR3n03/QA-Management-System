-- CreateEnum
CREATE TYPE "CheckOutcome" AS ENUM ('PASSED', 'FAILED', 'ERRORED', 'SKIPPED');

-- CreateTable
CREATE TABLE "CheckBatch" (
    "id" TEXT NOT NULL,
    "sourceFileName" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "reportJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "CheckBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Check" (
    "id" TEXT NOT NULL,
    "checkBatchId" TEXT NOT NULL,
    "testCaseId" TEXT NOT NULL,
    "specName" TEXT NOT NULL,
    "testName" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "outcome" "CheckOutcome" NOT NULL,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "Check_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CheckBatch_startedAt_idx" ON "CheckBatch"("startedAt");

-- CreateIndex
CREATE INDEX "Check_testCaseId_checkedAt_idx" ON "Check"("testCaseId", "checkedAt");

-- CreateIndex
CREATE INDEX "Check_checkBatchId_idx" ON "Check"("checkBatchId");

-- AddForeignKey
ALTER TABLE "CheckBatch" ADD CONSTRAINT "CheckBatch_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Check" ADD CONSTRAINT "Check_checkBatchId_fkey" FOREIGN KEY ("checkBatchId") REFERENCES "CheckBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Check" ADD CONSTRAINT "Check_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

