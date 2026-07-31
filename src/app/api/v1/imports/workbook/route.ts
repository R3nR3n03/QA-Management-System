import { createImportRun } from "@/domain/imports";
import { withRoute } from "@/lib/route";
import { AppError } from "@/lib/errors";

export async function POST(request: Request) {
  return withRoute(request, async ({ auth, requestId }) => {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      // A missing multipart field is a malformed request, not a missing referenced record;
      // ID_INVALID is the established 422 pairing for boundary-shape failures.
      throw new AppError(422, "ID_INVALID", "Missing workbook file.", "file");
    }
    const bytes = await file.arrayBuffer();
    // The QA-Lead gate now lives in createImportRun, where api-and-security.md:38
    // requires it, rather than only here.
    const run = await createImportRun(
      { userId: auth.userId, role: auth.role, requestId },
      file.name,
      Buffer.from(bytes)
    );
    return Response.json(run, { status: 201 });
  });
}
