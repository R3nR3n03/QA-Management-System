import { createImportRun } from "@/domain/imports";
import { withRoute } from "@/lib/route";
import { ensureRole, RoleSets } from "@/lib/rbac";
import { AppError } from "@/lib/errors";
import { assertWithinUploadLimit, headerContentLength, maxUploadBytes } from "@/lib/upload-limits";

export async function POST(request: Request) {
  return withRoute(request, async ({ auth, requestId }) => {
    ensureRole([...RoleSets.canAdmin], auth.role);

    const limit = maxUploadBytes();

    // FIRST, and before touching the body. `request.formData()` buffers the entire
    // multipart payload into memory, so a check after it has already paid the cost
    // this limit exists to avoid. Content-Length includes multipart overhead, making
    // this marginally conservative — immaterial against an MB-scale limit.
    assertWithinUploadLimit(headerContentLength(request.headers.get("content-length")), limit);

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      // A missing multipart field is a malformed request, not a missing referenced record;
      // ID_INVALID is the established 422 pairing for boundary-shape failures.
      throw new AppError(422, "ID_INVALID", "Missing workbook file.", "file");
    }

    // SECOND, because the header above is a hint, not a guarantee: a chunked request
    // sends no Content-Length at all, and a supplied one need not be honest. This is
    // the check that actually holds.
    assertWithinUploadLimit(file.size, limit);

    const bytes = await file.arrayBuffer();
    const run = await createImportRun(auth.userId, file.name, Buffer.from(bytes), requestId);
    return Response.json(run, { status: 201 });
  });
}
