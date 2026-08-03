import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

declare global {
  var prismaGlobal: PrismaClient | undefined;
}

/**
 * The adapter owns a `pg` connection Pool, so it must be constructed ONLY when a client
 * is actually being created.
 *
 * Built at module scope it was constructed on every evaluation of this module — which in
 * dev means every HMR reload — and then thrown away, because the `??` below returned the
 * cached `prismaGlobal` client instead. Nothing ever called `end()` on those pools, so a
 * long dev session accumulated one orphaned Pool per reload. Behind a function they are
 * only built on the path that keeps them.
 */
function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg(process.env.DATABASE_URL as string),
    log: ["error"]
  });
}

export const prisma = global.prismaGlobal ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.prismaGlobal = prisma;
}
