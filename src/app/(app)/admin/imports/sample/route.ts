import { QamsRole } from "@prisma/client";
import { requireAuth } from "@/lib/auth";
import { asErrorResponse, AppError } from "@/lib/errors";
import { requestMetadata } from "@/lib/request-metadata";
import { buildSampleWorkbook, SAMPLE_WORKBOOK_FILENAME } from "@/domain/import-template";

/**
 * Downloads the sample/template workbook offered on `/admin/imports`.
 *
 * ## Why this is not under `/api/v1`
 *
 * `docs/api-and-security.md:16` enumerates the Administration API surface —
 * `POST /imports/workbook`, `GET /imports/{id}`, controlled values, users. A sample
 * download is not on that list, and adding an endpoint to the documented API is a
 * policy change that needs a `docs/` edit and QA Lead sign-off, not a side effect of a
 * UI convenience. So it lives beside the screen it serves. Promoting it to
 * `GET /api/v1/imports/sample` later is a file move plus the doc change.
 *
 * ## Gate
 *
 * Same as the screen: imports are a QA-Lead capability (`roles-workflows.md:16`), and
 * `/admin/imports` 404s for everyone else. This refuses rather than 404s because it is
 * fetched directly rather than navigated to — the caller is a download, not a person
 * who might be confused by an error page.
 *
 * The response is thin by design: the workbook is built by one domain function, which
 * is pure and holds all the knowledge about what the file must contain.
 */
export async function GET() {
  try {
    const auth = await requireAuth();
    if (auth.role !== QamsRole.QA_LEAD) {
      throw new AppError(403, "UNAUTHORIZED", "Workbook imports are a QA Lead capability.");
    }

    const workbook = buildSampleWorkbook();

    return new Response(new Uint8Array(workbook), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${SAMPLE_WORKBOOK_FILENAME}"`,
        "Content-Length": String(workbook.byteLength),
        // Generated per request from code, never from stored data — but it changes only
        // when the parser's headers do, so a short cache costs nothing and a stale copy
        // is not possible across a deploy.
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    // Same error shape and requestId discipline the API boundary uses, so a failed
    // download is diagnosable from the same reference as everything else.
    const { requestId } = await requestMetadata();
    return asErrorResponse(error, requestId);
  }
}
