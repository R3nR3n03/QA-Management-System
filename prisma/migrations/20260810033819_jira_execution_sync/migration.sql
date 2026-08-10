-- CreateEnum
CREATE TYPE "JiraSyncOutcome" AS ENUM ('SUCCEEDED', 'FAILED', 'ABANDONED');

-- AlterTable
ALTER TABLE "TestExecution" ADD COLUMN     "jiraIssueKey" TEXT;

-- CreateTable
CREATE TABLE "JiraSyncAttempt" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "jiraIssueKey" TEXT NOT NULL,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" "JiraSyncOutcome" NOT NULL,
    "failureReason" TEXT,
    "actorId" TEXT,

    CONSTRAINT "JiraSyncAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JiraCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JiraCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JiraSyncAttempt_executionId_idx" ON "JiraSyncAttempt"("executionId");

-- CreateIndex
CREATE INDEX "JiraSyncAttempt_outcome_idx" ON "JiraSyncAttempt"("outcome");

-- CreateIndex
CREATE INDEX "JiraSyncAttempt_jiraIssueKey_idx" ON "JiraSyncAttempt"("jiraIssueKey");

-- CreateIndex
CREATE UNIQUE INDEX "JiraCredential_userId_key" ON "JiraCredential"("userId");

-- CreateIndex
CREATE INDEX "TestExecution_jiraIssueKey_idx" ON "TestExecution"("jiraIssueKey");

-- AddForeignKey
ALTER TABLE "JiraSyncAttempt" ADD CONSTRAINT "JiraSyncAttempt_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "TestExecution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JiraCredential" ADD CONSTRAINT "JiraCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
