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
      // A missing multipart field is a malformed request, not a missing referenced record;
      // ID_INVALID is the established 422 pairing for boundary-shape failures.
      throw new AppError(422, "ID_INVALID", "Missing workbook file.", "file");
    }
    const bytes = await file.arrayBuffer();
    const run = await createImportRun(auth.userId, file.name, Buffer.from(bytes), requestId);
    return Response.json(run, { status: 201 });
  });
}
