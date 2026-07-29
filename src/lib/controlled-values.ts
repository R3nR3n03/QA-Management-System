import { prisma } from "./db";
import { AppError } from "./errors";

export async function ensureActiveControlledValue(catalogue: string, value: string, field: string) {
  const row = await prisma.controlledValue.findFirst({ where: { catalogue, value } });
  if (!row || !row.active) {
    throw new AppError(422, "CONTROLLED_VALUE_INVALID", `${field} must be an active configured value.`, field);
  }
}
