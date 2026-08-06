-- AlterTable
ALTER TABLE "ImportRowReport" ADD COLUMN     "proposedValuesJson" JSONB,
ADD COLUMN     "resolutionDecision" TEXT,
ADD COLUMN     "resolutionRationale" TEXT,
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "resolvedBy" TEXT;
