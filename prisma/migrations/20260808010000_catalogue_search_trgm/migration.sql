-- Trigram indexes for the catalogue explorer's search.
--
-- `searchCatalogue` (src/domain/catalogue.ts) matches with `ILIKE '%needle%'` across the
-- name of a Product, Module and Feature and the statement of a Requirement. A leading
-- wildcard cannot use a btree index at all — including the `@unique` one on businessId —
-- so before these indexes every search was a sequential scan of the whole table.
--
-- The search is already bounded by LIMIT, so the OUTPUT was never the problem; the scan
-- was. These make the scan an index probe.
--
-- Additive and reversible: four indexes and one extension, no column added, dropped or
-- renamed, and no data touched. Dropping them makes search slow again and nothing else.
--
-- pg_trgm ships with PostgreSQL as a contrib module. `CREATE EXTENSION` needs privileges
-- the application role may not have; run this migration as the database owner.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "Product_name_trgm_idx" ON "Product" USING GIN ("name" gin_trgm_ops);

CREATE INDEX "Module_name_trgm_idx" ON "Module" USING GIN ("name" gin_trgm_ops);

CREATE INDEX "Feature_name_trgm_idx" ON "Feature" USING GIN ("name" gin_trgm_ops);

-- The largest of the four tables, and the longest text in them.
CREATE INDEX "Requirement_statement_trgm_idx" ON "Requirement" USING GIN ("statement" gin_trgm_ops);
