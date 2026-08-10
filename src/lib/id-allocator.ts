import type { Prisma } from "@prisma/client";
import { AppError } from "./errors";

/**
 * Race-safe business-ID allocation (`docs/business-rules-and-validation.md:11`,
 * `docs/data-model.md:5`): when a create request supplies no `businessId`, the domain
 * service calls `allocateBusinessId` INSIDE its existing transaction.
 *
 * One `IdSequence` row per key ("execution", "defect", "testCase:<productBusinessId>").
 * The `UPDATE … RETURNING` increment takes the row lock, so concurrent allocators on
 * the same key serialize for the rest of the transaction — which is also what lets one
 * finalize transaction hand out N distinct BUG IDs. The counter is only a hint:
 * imported and hand-supplied IDs can occupy numbers ahead of it, so the allocator
 * probes forward past taken numbers, and the `@unique` index on each `businessId`
 * column stays the final safeguard (P2002 → 409 ID_DUPLICATE via prisma-errors.ts).
 *
 * Lazy init: the first use of a key seeds `next` from the max numeric suffix already
 * persisted for that prefix — no backfill migration, and a key that has never been
 * used costs nothing.
 */

/**
 * The default number space: four-digit suffix, `0001`-`9999` — `EXE-`, `BUG-` and
 * `TC-<product>-`.
 *
 * Not the only one. The four catalogue levels are three digits (`PROD###`, `MOD###`,
 * `FEAT###`, `REQ###`), so width is a parameter rather than a constant. It was a constant
 * for as long as the allocator served only the four-digit entities, and that is exactly why
 * the catalogue services never used it: a four-digit allocator emits `REQ0001`, which
 * `BUSINESS_ID_PATTERNS.requirement` rejects. They asked for a hand-typed ID instead, in
 * breach of `docs/data-model.md:5`.
 */
const DEFAULT_SUFFIX_WIDTH = 4;

/** `999` for width 3, `9999` for width 4 — the largest number the format can express. */
function maxSuffix(width: number): number {
  return 10 ** width - 1;
}

/**
 * `prefix + zero-padded number` (e.g. `("EXE-", 7)` → `EXE-0007`, `("REQ", 7, 3)` → `REQ007`).
 * Numbers past the format's own space are refused — a documented limit, not handled
 * specially (`docs/data-model.md`, "allocation past 9999 is refused").
 */
export function formatBusinessId(
  prefix: string,
  n: number,
  width: number = DEFAULT_SUFFIX_WIDTH
): string {
  const max = maxSuffix(width);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    throw new AppError(
      422,
      "ID_INVALID",
      // The hash run matches the width, so the message names the space that is actually
      // exhausted rather than one the format could not produce anyway.
      `The ${prefix}${"#".repeat(width)} number space is exhausted; no free ID below ${max + 1}.`,
      "businessId"
    );
  }
  return `${prefix}${String(n).padStart(width, "0")}`;
}

/**
 * The highest numeric suffix among `ids` that match `prefix` exactly (0 when none do).
 * Used to lazily seed a counter key on its first allocation. Non-numeric or
 * differently-shaped suffixes are ignored rather than tripping the seed.
 */
export function highestSuffix(prefix: string, ids: string[]): number {
  let max = 0;
  for (const id of ids) {
    if (!id.startsWith(prefix)) continue;
    const suffix = id.slice(prefix.length);
    if (!/^\d+$/.test(suffix)) continue;
    const n = Number(suffix);
    if (n > max) max = n;
  }
  return max;
}

export type AllocatorFormat = {
  /** Everything before the number, e.g. `"EXE-"` or `` `TC-${productBusinessId}-` ``. */
  prefix: string;
  /**
   * Digits in the zero-padded suffix. Omit for the four-digit default (`EXE-`, `BUG-`,
   * `TC-<product>-`); the catalogue levels pass 3.
   */
  width?: number;
  /** True when this candidate ID is already persisted (or created earlier in this tx). */
  isTaken: (candidate: string) => Promise<boolean>;
  /** Max numeric suffix currently in use for this prefix — the lazy counter seed. */
  currentMax: () => Promise<number>;
};

/**
 * Allocates the next free business ID for `key` inside the caller's transaction.
 * See the module comment for the locking and probing story.
 */
export async function allocateBusinessId(
  tx: Prisma.TransactionClient,
  key: string,
  format: AllocatorFormat
): Promise<string> {
  const width = format.width ?? DEFAULT_SUFFIX_WIDTH;
  // Lock-and-increment. RETURNING gives the incremented value; the number this call
  // owns is the value BEFORE the increment. An empty result means the key has never
  // been used — seed it and try once more (ON CONFLICT tolerates a concurrent seeder;
  // whoever loses the race just goes through the locked UPDATE like everyone else).
  let claimed: number | undefined;
  for (let attempt = 0; attempt < 2 && claimed === undefined; attempt += 1) {
    const rows = await tx.$queryRaw<Array<{ next: number }>>`
      UPDATE "IdSequence" SET "next" = "next" + 1 WHERE "key" = ${key} RETURNING "next"
    `;
    if (rows.length > 0) {
      claimed = rows[0].next - 1;
      break;
    }
    const seed = (await format.currentMax()) + 1;
    await tx.$executeRaw`
      INSERT INTO "IdSequence" ("key", "next") VALUES (${key}, ${seed})
      ON CONFLICT ("key") DO NOTHING
    `;
  }
  if (claimed === undefined) {
    // Two failed passes can only mean the row vanished between them — nothing deletes
    // counter rows, so surface it rather than loop.
    throw new AppError(
      422,
      "ID_INVALID",
      `Could not allocate an ID for ${format.prefix}${"#".repeat(width)}.`,
      "businessId"
    );
  }

  // Probe past numbers occupied ahead of the counter (imports, hand-supplied IDs).
  let candidate = claimed;
  while (await format.isTaken(formatBusinessId(format.prefix, candidate, width))) {
    candidate += 1;
  }

  // If probing consumed numbers, move the counter past them so the next allocation
  // does not re-probe the same span. We hold the row lock, so this cannot race.
  if (candidate !== claimed) {
    await tx.idSequence.update({ where: { key }, data: { next: candidate + 1 } });
  }

  return formatBusinessId(format.prefix, candidate, width);
}
