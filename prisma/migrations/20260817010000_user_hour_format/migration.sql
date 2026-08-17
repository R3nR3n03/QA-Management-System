-- Whether a person's screens draw a stamp on a 12- or 24-hour clock: the second half of
-- their display preferences, alongside the viewer zone added in 20260817000000 (ADR-0007).
--
-- Nullable, with no default and no backfill, for the same reason the zone is. NULL means
-- "has never chosen", which resolves to H24 -- what every screen rendered before this column
-- existed. Backfilling H24 would make an untouched deployment indistinguishable from one
-- where every person had deliberately picked the 24-hour clock, and there is no way back
-- from that.
--
-- Unlike the zone there is no deployment-level fallback between the person and the default.
-- The only other audience for a stamp is a reader in Jira, and that surface is fixed at
-- 24-hour rather than configurable: `22:32 Asia/Manila` is already unambiguous to a stranger
-- and `10:32 PM` is strictly more to parse, so the organization has nothing to decide here.
--
-- Stored timestamps are untouched. Every one remains a UTC instant.
CREATE TYPE "HourFormat" AS ENUM ('H12', 'H24');

ALTER TABLE "User" ADD COLUMN "hourFormat" "HourFormat";
