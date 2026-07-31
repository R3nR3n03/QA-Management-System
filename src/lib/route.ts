import { requireAuth } from "./auth";
import { asErrorResponse } from "./errors";
import { requestMetadata } from "./request-metadata";

type RouteHandler<T = unknown> = (ctx: {
  auth: Awaited<ReturnType<typeof requireAuth>>;
  requestId: string;
  body?: T;
  request: Request;
}) => Promise<Response>;

export async function withRoute<T>(request: Request, handler: RouteHandler<T>) {
  const { requestId } = await requestMetadata();
  try {
    const auth = await requireAuth();
    return await handler({ auth, requestId, request });
  } catch (error) {
    return asErrorResponse(error, requestId);
  }
}
