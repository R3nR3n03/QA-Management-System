import { dashboardSnapshot } from "@/domain/traceability";
import { withRoute } from "@/lib/route";

export async function GET(request: Request) {
  return withRoute(request, async () => {
    const snapshot = await dashboardSnapshot();
    return Response.json(snapshot);
  });
}
