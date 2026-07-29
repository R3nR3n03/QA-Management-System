/**
 * Controlled-value catalogue names and their bootstrap values.
 *
 * Authority: `docs/excel-source-map.md` § "Source-controlled values". That table is
 * the sole source of truth for the values below. Do not add, rename, or remove a
 * catalogue or a value here without a corresponding documentation change first —
 * inventing values is a policy decision that belongs to the QA Lead, not to code.
 *
 * This module must remain dependency-free. It is imported by `prisma/seed.ts` and by
 * unit tests, neither of which may pull in `./db` (which constructs a Prisma client at
 * module load from `process.env.DATABASE_URL`). Add no imports to this file.
 *
 * Catalogue names are matched case- and whitespace-sensitively by
 * `ensureActiveControlledValue`, so the exact spelling here is load-bearing.
 */

export const CATALOGUE_PRIORITY = "Priority" as const;
export const CATALOGUE_SEVERITY = "Severity" as const;
export const CATALOGUE_RESULT = "Result" as const;

export type ControlledCatalogue =
  | typeof CATALOGUE_PRIORITY
  | typeof CATALOGUE_SEVERITY
  | typeof CATALOGUE_RESULT;

export type ControlledValueSeed = {
  readonly catalogue: ControlledCatalogue;
  readonly value: string;
};

export type ControlledValueSeedRow = {
  readonly catalogue: ControlledCatalogue;
  readonly value: string;
  readonly createdBy: string;
  readonly updatedBy: string;
};

/**
 * The nine values the workbook seeds, exactly as documented. `Not Executed` is
 * deliberately absent: `excel-source-map.md` records it as a legacy source value only.
 */
export const SEED_CONTROLLED_VALUES: readonly ControlledValueSeed[] = [
  { catalogue: CATALOGUE_PRIORITY, value: "High" },
  { catalogue: CATALOGUE_PRIORITY, value: "Medium" },
  { catalogue: CATALOGUE_PRIORITY, value: "Low" },
  { catalogue: CATALOGUE_SEVERITY, value: "Critical" },
  { catalogue: CATALOGUE_SEVERITY, value: "Major" },
  { catalogue: CATALOGUE_SEVERITY, value: "Minor" },
  { catalogue: CATALOGUE_RESULT, value: "Pass" },
  { catalogue: CATALOGUE_RESULT, value: "Fail" },
  { catalogue: CATALOGUE_RESULT, value: "Blocked" }
];

/**
 * Builds the rows to persist for a bootstrap run. `createdBy` / `updatedBy` are
 * required non-defaulted columns on `ControlledValue`, so the caller must supply the
 * actor (the seed script uses `"seed"`, matching the convention already established
 * for the bootstrap QA Lead user).
 */
export function buildControlledValueSeedRows(actor: string): readonly ControlledValueSeedRow[] {
  return SEED_CONTROLLED_VALUES.map((entry) => ({
    catalogue: entry.catalogue,
    value: entry.value,
    createdBy: actor,
    updatedBy: actor
  }));
}
