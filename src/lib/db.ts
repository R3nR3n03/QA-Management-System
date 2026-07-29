import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

declare global {
  var prismaGlobal: PrismaClient | undefined;
}

const adapter = new PrismaPg(process.env.DATABASE_URL as string);

export const prisma =
  global.prismaGlobal ??
  new PrismaClient({
    adapter,
    log: ["error"]
  });

if (process.env.NODE_ENV !== "production") {
  global.prismaGlobal = prisma;
}
