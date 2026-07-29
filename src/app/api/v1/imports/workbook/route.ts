import { createImportRun } from "@/domain/imports";
import { withRoute } from "@/lib/route";
import { ensureRole, RoleSets } from "@/lib/rbac";
import { AppError } from "@/lib/errors";

export async function POST(request: Request) {
  return withRoute(request, async ({ auth, requestId }) => {
    ensureRole([...RoleSets.canAdmin], auth.role);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new AppError(422, "REFERENCE_NOT_FOUND", "Missing workbook file.");
    }
    const bytes = await file.arrayBuffer();
    const run = await createImportRun(auth.userId, file.name, Buffer.from(bytes), requestId);
    return Response.json(run, { status: 201 });
  });
}
