-- A finalize that declines to transition an issue now records WHY, instead of returning
-- silently and leaving an empty table as the only evidence. See ADR-0005.
ALTER TYPE "JiraSyncOutcome" ADD VALUE 'SKIPPED';
