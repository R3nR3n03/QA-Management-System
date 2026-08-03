-- Business-ID sequence counters (`docs/data-model.md:5`): one row per key
-- ("execution", "defect", "testCase:<productBusinessId>"). No backfill — the
-- allocator lazily seeds a key from the max existing numeric suffix on first use.

-- CreateTable
CREATE TABLE "IdSequence" (
    "key" TEXT NOT NULL,
    "next" INTEGER NOT NULL,

    CONSTRAINT "IdSequence_pkey" PRIMARY KEY ("key")
);
