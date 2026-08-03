-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_occurredAt_idx" ON "AuditEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actorId_idx" ON "AuditEvent"("actorId");

-- CreateIndex
CREATE INDEX "Defect_testCaseId_status_idx" ON "Defect"("testCaseId", "status");

-- CreateIndex
CREATE INDEX "Defect_status_idx" ON "Defect"("status");

-- CreateIndex
CREATE INDEX "Defect_createdAt_idx" ON "Defect"("createdAt");

-- CreateIndex
CREATE INDEX "DefectExecutionLink_executionId_idx" ON "DefectExecutionLink"("executionId");

-- CreateIndex
CREATE INDEX "ExecutionHistory_executionId_occurredAt_idx" ON "ExecutionHistory"("executionId", "occurredAt");

-- CreateIndex
CREATE INDEX "ExecutionHistory_testCaseId_idx" ON "ExecutionHistory"("testCaseId");

-- CreateIndex
CREATE INDEX "ExecutionTestCase_testCaseId_idx" ON "ExecutionTestCase"("testCaseId");

-- CreateIndex
CREATE INDEX "Feature_moduleId_idx" ON "Feature"("moduleId");

-- CreateIndex
CREATE INDEX "ImportRowReport_importRunId_idx" ON "ImportRowReport"("importRunId");

-- CreateIndex
CREATE INDEX "Module_productId_idx" ON "Module"("productId");

-- CreateIndex
CREATE INDEX "Requirement_featureId_idx" ON "Requirement"("featureId");

-- CreateIndex
CREATE INDEX "RequirementTraceLink_testCaseId_idx" ON "RequirementTraceLink"("testCaseId");

-- CreateIndex
CREATE INDEX "RequirementTraceLink_defectId_idx" ON "RequirementTraceLink"("defectId");

-- CreateIndex
CREATE INDEX "RequirementTraceLink_createdAt_idx" ON "RequirementTraceLink"("createdAt");

-- CreateIndex
CREATE INDEX "TestCase_lifecycleState_idx" ON "TestCase"("lifecycleState");

-- CreateIndex
CREATE INDEX "TestCase_productId_idx" ON "TestCase"("productId");

-- CreateIndex
CREATE INDEX "TestCase_moduleId_idx" ON "TestCase"("moduleId");

-- CreateIndex
CREATE INDEX "TestCase_featureId_idx" ON "TestCase"("featureId");

-- CreateIndex
CREATE INDEX "TestCase_requirementId_idx" ON "TestCase"("requirementId");

-- CreateIndex
CREATE INDEX "TestCase_revisesTestCaseId_idx" ON "TestCase"("revisesTestCaseId");

-- CreateIndex
CREATE INDEX "TestExecution_testerId_state_idx" ON "TestExecution"("testerId", "state");

-- CreateIndex
CREATE INDEX "TestExecution_state_idx" ON "TestExecution"("state");

-- CreateIndex
CREATE INDEX "TestExecution_createdAt_idx" ON "TestExecution"("createdAt");
