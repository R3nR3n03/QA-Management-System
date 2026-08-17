-- QAMS raises a Jira bug for a defect, narrates its lifecycle, and closes the issue when the
-- defect closes. See ADR-0006 and `docs/architecture.md#Jira defect sync`.

-- Which of the three writes an attempt row describes. One enum and one table rather than the
-- two-table split on the execution side: all three speak for exactly one defect and are read
-- together as one timeline.
CREATE TYPE "JiraDefectAction" AS ENUM ('CREATE', 'COMMENT', 'TRANSITION');

-- The issue QAMS raised, written back once creation succeeds. Nullable: a defect that predates
-- this feature, or one whose creation has not run or has failed, carries no key.
ALTER TABLE "Defect" ADD COLUMN "jiraIssueKey" TEXT;

-- Unique, unlike TestExecution.jiraIssueKey which many runs deliberately share. One defect is
-- one bug, and this constraint -- not a rule in a service -- is what stops a retry adopting an
-- issue another defect has already claimed. Postgres treats NULLs as distinct in a unique
-- index, so the many defects carrying no key at all never collide with each other.
CREATE UNIQUE INDEX "Defect_jiraIssueKey_key" ON "Defect"("jiraIssueKey");

CREATE TABLE "JiraDefectAttempt" (
    "id" TEXT NOT NULL,
    "defectId" TEXT NOT NULL,
    "action" "JiraDefectAction" NOT NULL,
    -- Nullable here and nowhere else: a failed CREATE is the one attempt that can exist before
    -- any issue key does, and that row is the whole record that QAMS tried and could not.
    "jiraIssueKey" TEXT,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" "JiraSyncOutcome" NOT NULL,
    "jiraCommentId" TEXT,
    "failureReason" TEXT,
    "actorId" TEXT,

    CONSTRAINT "JiraDefectAttempt_pkey" PRIMARY KEY ("id")
);

-- The defect screen reads this defect's attempts, newest first.
CREATE INDEX "JiraDefectAttempt_defectId_attemptedAt_idx" ON "JiraDefectAttempt" ("defectId", "attemptedAt");

-- The retry worker queues on this pair: failed CREATEs and TRANSITIONs, never COMMENTs.
CREATE INDEX "JiraDefectAttempt_action_outcome_idx" ON "JiraDefectAttempt" ("action", "outcome");

-- Cascade from the defect: the attempts are that defect's story and outlive nothing without it.
ALTER TABLE "JiraDefectAttempt" ADD CONSTRAINT "JiraDefectAttempt_defectId_fkey"
    FOREIGN KEY ("defectId") REFERENCES "Defect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Restrict on the actor, matching JiraSyncAttempt: docs/data-model.md relies on actor
-- references staying resolvable forever. No user row is ever deleted, so this never fires.
ALTER TABLE "JiraDefectAttempt" ADD CONSTRAINT "JiraDefectAttempt_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
