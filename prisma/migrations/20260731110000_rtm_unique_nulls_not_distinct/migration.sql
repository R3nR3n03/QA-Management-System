-- PRODUCTION-READINESS-2026-07-31.md B3
--
-- `docs/data-model.md:27` specifies the RTM link as unique on
-- (requirementId, testCaseId, defectId). The generated index implemented that literally,
-- and in PostgreSQL two NULLs are never equal -- so the constraint deduplicated nothing
-- whenever `defectId` was NULL, which `docs/business-rules-and-validation.md:36` explicitly
-- permits ("The system permits an RTM link without a defect"). Unlimited identical
-- (requirement, testCase, NULL) rows were insertable; a probe inserted three in a row with
-- zero rejections.
--
-- NULLS NOT DISTINCT (PostgreSQL 15+; this database is 18.4) makes the existing index treat
-- NULL as a comparable value, which is what the data model meant. Preferred over a partial
-- unique index because it is one object rather than two and states the intent directly.
--
-- NOTE: Prisma has no schema syntax for NULLS NOT DISTINCT, so `prisma/schema.prisma`
-- cannot express this and a comment there points here instead.

DROP INDEX "RequirementTraceLink_requirementId_testCaseId_defectId_key";

CREATE UNIQUE INDEX "RequirementTraceLink_requirementId_testCaseId_defectId_key"
  ON "RequirementTraceLink" ("requirementId", "testCaseId", "defectId") NULLS NOT DISTINCT;
