-- CreateEnum
CREATE TYPE "JiraCommentOutcome" AS ENUM ('SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "JiraCommentAttempt" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "jiraIssueKey" TEXT NOT NULL,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" "JiraCommentOutcome" NOT NULL,
    "jiraCommentId" TEXT,
    "failureReason" TEXT,
    "actorId" TEXT,

    CONSTRAINT "JiraCommentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JiraCommentAttempt_executionId_idx" ON "JiraCommentAttempt"("executionId");

-- AddForeignKey
ALTER TABLE "JiraCommentAttempt" ADD CONSTRAINT "JiraCommentAttempt_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "TestExecution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JiraCommentAttempt" ADD CONSTRAINT "JiraCommentAttempt_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
