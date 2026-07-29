import * as XLSX from "xlsx";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { appendAudit } from "@/lib/audit";

const EXPECTED_SHEETS = [
  "Home",
  "Product Master",
  "Module Master",
  "Feature Master",
  "Requirement Master",
  "Test Repository",
  "Test Steps",
  "Test Execution",
  "Execution History",
  "Bug Tracker",
  "RTM",
  "Dashboard",
  "Settings"
];

export async function createImportRun(actorId: string, fileName: string, rawBuffer: Buffer, requestId: string) {
  const workbook = XLSX.read(rawBuffer, { type: "buffer" });
  for (const sheet of EXPECTED_SHEETS) {
    if (!workbook.SheetNames.includes(sheet)) {
      throw new AppError(422, "REFERENCE_NOT_FOUND", `Missing required sheet: ${sheet}.`);
    }
  }

  const run = await prisma.importRun.create({
    data: {
      sourceFileName: fileName,
      actorId,
      status: "VALIDATED",
      reportJson: { sheets: workbook.SheetNames },
      createdBy: actorId
    }
  });

  await appendAudit(prisma, {
    actorId,
    action: "IMPORT_VALIDATED",
    entityType: "ImportRun",
    entityId: run.id,
    requestId,
    beforeAfterJson: {
      after: { sourceFileName: fileName, sheetCount: workbook.SheetNames.length }
    }
  });

  return run;
}
