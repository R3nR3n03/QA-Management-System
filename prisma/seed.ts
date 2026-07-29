import "dotenv/config";
import { PrismaClient, QamsRole } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../src/lib/password";

const adapter = new PrismaPg(process.env.DATABASE_URL as string);
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = process.env.SEED_QA_LEAD_EMAIL ?? "qa.lead@example.com";
  const password = process.env.SEED_QA_LEAD_PASSWORD;
  if (!password) {
    throw new Error("Set SEED_QA_LEAD_PASSWORD before running the seed script.");
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Seed user ${email} already exists; skipping.`);
    return;
  }

  const user = await prisma.user.create({
    data: {
      email,
      displayName: "Seed QA Lead",
      passwordHash: hashPassword(password),
      role: QamsRole.QA_LEAD,
      createdBy: "seed",
      updatedBy: "seed"
    }
  });

  console.log(`Created bootstrap QA Lead user ${user.email} (${user.id}).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
