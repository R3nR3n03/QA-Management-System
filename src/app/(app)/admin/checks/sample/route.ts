import { QamsRole } from "@prisma/client";
import { requireAuth } from "@/lib/auth";
import { asErrorResponse, AppError } from "@/lib/errors";
import { requestMetadata } from "@/lib/request-metadata";
import { buildSampleResultsFile, SAMPLE_RESULTS_FILENAME } from "@/domain/check-sample";

/**
 * Downloads the sample results file offered on `/admin/checks`.
 *
 * ## Why this is not under `/api/v1`
 *
 * `docs/api-and-security.md` § "Automation check ingestion interface" enumerates that
 * surface as `POST /check-batches` and `GET /check-batches/{id}`. A sample download is
 * not on it, and adding an endpoint to the documented API is a policy change needing a
 * `docs/` edit and QA Lead sign-off rather than a UI convenience. So it lives beside the
 * screen it serves, exactly as `/admin/imports/sample` does.
 *
 * ## Gate
 *
 * Same as the screen: ingestion is a QA-Lead capability (`roles-workflows.md`), and
 * `/admin/checks` 404s for everyone else. This refuses rather than 404s because it is
 * fetched directly rather than navigated to — the caller is a download, not a person who
 * might be confused by an error page. The gate is not widened for the automation engineer
 * who has to configure the reporter: the artifact is a file, so a QA Lead who wants them
 * to have it sends it, and no divergence from the imports route has to be explained.
 *
 * The response is thin by design: the file is built by one pure domain function that holds
 * all the knowledge about what it must contain.
 */
export async function GET() {
  try {
    const auth = await requireAuth();
    if (auth.role !== QamsRole.QA_LEAD) {
      throw new AppError(403, "UNAUTHORIZED", "Automation check ingestion is a QA Lead capability.");
    }

    const xml = buildSampleResultsFile();

    return new Response(xml, {
      headers: {
        // The same types the upload input accepts.
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${SAMPLE_RESULTS_FILENAME}"`,
        "Content-Length": String(Buffer.byteLength(xml)),
        // Generated per request from code, never from stored data — but it changes only
        // when the sample does, so a stale copy is not possible across a deploy.
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
