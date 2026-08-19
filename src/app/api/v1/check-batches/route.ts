import { createCheckBatch } from "@/domain/checks";
import { withRoute } from "@/lib/route";
import { AppError } from "@/lib/errors";
import { assertWithinRateLimit, importLimiter } from "@/lib/rate-limit";
import { assertWithinUploadLimit, headerContentLength, maxUploadBytes } from "@/lib/upload-limits";

/**
 * Ingest one JUnit XML results file (`docs/api-and-security.md#Automation check ingestion
 * interface`).
 *
 * The three gates below are the workbook import's, in the same order and for the same
 * reasons: `docs/api-and-security.md` requires import endpoints to be throttled, and the
 * point of throttling first is that a rejected caller never reaches `formData()`, which
 * buffers the whole multipart payload into memory before anything can inspect it.
 *
 * The QA-Lead gate is NOT here. It lives in `createCheckBatch`, where the matrix has to be
 * enforced so that every future caller — a CLI, a job, a test — meets it too.
 */
export async function POST(request: Request) {
  return withRoute(request, async ({ auth, requestId }) => {
    assertWithinRateLimit(importLimiter.consume(`user:${auth.userId}`));

    const limit = maxUploadBytes();
    assertWithinUploadLimit(headerContentLength(request.headers.get("content-length")), limit, "results file");

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new AppError(422, "ID_INVALID", "Missing results file.", "file");
    }

    // The header above is a hint; a chunked request sends none and a supplied one need not
    // be honest. This is the check that actually holds.
    assertWithinUploadLimit(file.size, limit, "results file");

    const batch = await createCheckBatch(
      { userId: auth.userId, role: auth.role, requestId },
      file.name,
      await file.text()
    );
    return Response.json(batch, { status: 201 });
  });
}
