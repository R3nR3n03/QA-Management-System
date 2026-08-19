import { QamsRole } from "@prisma/client";
import { listApprovedCandidates } from "@/domain/test-cases";
import { buildNamingContract, NAMING_CONTRACT_FILENAME, type ContractCase } from "@/domain/naming-contract";
import { requireAuth } from "@/lib/auth";
import { asErrorResponse, AppError } from "@/lib/errors";
import { requestMetadata } from "@/lib/request-metadata";

/**
 * Builds and returns the naming contract for a selection of test cases.
 *
 * ## Why POST, and why its own segment
 *
 * A selection is input, so it travels in a body rather than a URL that would truncate at a
 * few hundred cases — see `ContractForm`. And Next refuses `page.tsx` and `route.ts` in one
 * directory, so the download lives one segment below the screen that submits to it.
 *
 * ## Why this is not under `/api/v1`
 *
 * Same as `/admin/checks/sample`: `docs/api-and-security.md` enumerates the Administration
 * surface, a contract download is not on it, and adding an endpoint to the documented API
 * is a policy change needing a `docs/` edit and QA Lead sign-off rather than a side effect
 * of a UI convenience.
 *
 * ## Gate
 *
 * Same as the screen — a QA Lead capability (`docs/roles-workflows.md`). It refuses rather
 * than 404s because it is submitted to directly rather than navigated to.
 *
 * The selection is intersected with what is actually offerable rather than trusted: only an
 * Approved case belongs in a contract, and ids arrive from a browser.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireAuth();
    if (auth.role !== QamsRole.QA_LEAD) {
      throw new AppError(403, "UNAUTHORIZED", "Automation check ingestion is a QA Lead capability.");
    }

    const form = await request.formData();
    const requested = new Set(
      form
        .getAll("cases")
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter((value) => value !== "")
    );

    const cases: ContractCase[] = (await listApprovedCandidates())
      .filter((testCase) => requested.has(testCase.id))
      .map((testCase) => ({
        businessId: testCase.businessId,
        title: testCase.title,
        featureBusinessId: testCase.feature.businessId,
        featureName: testCase.feature.name,
        moduleName: testCase.module.name
      }));

    // Refuses an empty selection, which is also what an entirely stale one arrives as.
    const markdown = buildNamingContract(cases, new Date());

    return new Response(markdown, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${NAMING_CONTRACT_FILENAME}"`,
        "Content-Length": String(Buffer.byteLength(markdown)),
        // Built per request from a selection; there is nothing here to cache.
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
