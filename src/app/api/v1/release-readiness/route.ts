import { releaseReadinessSnapshot } from "@/domain/traceability";
import { AppError } from "@/lib/errors";
import { withRoute } from "@/lib/route";

export async function GET(request: Request) {
  return withRoute(request, async ({ auth }) => {
    const url = new URL(request.url);
    const productId = url.searchParams.get("productId");
    const release = url.searchParams.get("release");
    const environment = url.searchParams.get("environment");
    if (!productId || !release || !environment) {
      throw new AppError(
        422,
        "ID_INVALID",
        "productId, release, and environment query parameters are required."
      );
    }
    const snapshot = await releaseReadinessSnapshot({ productId, release, environment }, auth.role);
    return Response.json(snapshot);
  });
}
