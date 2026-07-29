import { prisma } from "./db";
import type { ControlledCatalogue } from "./controlled-value-catalogues";
import { AppError } from "./errors";

export async function ensureActiveControlledValue(
  catalogue: ControlledCatalogue,
  value: string,
  field: string
) {
  const row = await prisma.controlledValue.findFirst({ where: { catalogue, value } });
  if (!row || !row.active) {
    throw new AppError(422, "CONTROLLED_VALUE_INVALID", `${field} must be an active configured value.`, field);
  }
}
