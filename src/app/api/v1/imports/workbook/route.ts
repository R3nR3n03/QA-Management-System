import { createImportRun } from "@/domain/imports";
import { withRoute } from "@/lib/route";
import { ensureRole, RoleSets } from "@/lib/rbac";
import { AppError } from "@/lib/errors";
import { assertWithinRateLimit, importLimiter } from "@/lib/rate-limit";
import { assertWithinUploadLimit, headerContentLength, maxUploadBytes } from "@/lib/upload-limits";

export async function POST(request: Request) {
  return withRoute(request, async ({ auth, requestId }) => {
    ensureRole([...RoleSets.canAdmin], auth.role);

    // A3, and it must come before the size check below, not after: `docs/api-and-security.md:43`
    // requires import endpoints to be throttled, and the point of throttling here is that a
    // rejected caller never reaches `formData()` — which buffers the whole multipart payload
    // into memory (A2) and hands it to a parser with a published ReDoS advisory (A1).
    //
    // Keyed on the authenticated user, not on a header: `withRoute` has already run
    // `requireAuth()`, so this is an identity the caller cannot forge or rotate. The thrown
    // AppError is logged by `withRoute`'s catch like any other.
    //
    // Every attempt is consumed here, successes included — unlike the CLIENT dimension of
    // the login throttle, which counts failures only. The reason that exception exists does
    // not apply: this key is one authenticated user, never a shared address, so exhausting
    // it can only ever inconvenience the account that actually did the importing.
    assertWithinRateLimit(importLimiter.consume(`user:${auth.userId}`));

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
