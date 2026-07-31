import { requireAuth } from "./auth";
import { AppError, asErrorResponse } from "./errors";
import { logRequest, requestTarget } from "./logging";
import { requestMetadata } from "./request-metadata";

type RouteHandler<T = unknown> = (ctx: {
  auth: Awaited<ReturnType<typeof requireAuth>>;
  requestId: string;
  body?: T;
  request: Request;
}) => Promise<Response>;

/**
 * The API boundary: authenticate, run the handler, map thrown errors to JSON, and
 * emit one structured log line per request.
 *
 * The logging is the point of the catch block being shaped this way. `asErrorResponse`
 * deliberately tells the client nothing on a 500 — `docs/api-and-security.md:33`
 * forbids exposing stack traces — which used to mean the detail was lost entirely.
 * The error is now recorded here, with its stack, before the sanitised response goes
 * out. The `requestId` in the response body and in the log line are the same value,
 * so a user's support reference finally leads somewhere.
 */
export async function withRoute<T>(request: Request, handler: RouteHandler<T>) {
  const startedAt = Date.now();
  const { requestId } = await requestMetadata();
  const target = requestTarget(request);
  let actorId: string | undefined;

  try {
    const auth = await requireAuth();
    actorId = auth.userId;
    const response = await handler({ auth, requestId, request });

    logRequest({
      ...target,
      occurredAt: new Date().toISOString(),
      requestId,
      status: response.status,
      actorId,
      durationMs: Date.now() - startedAt
    });

    return response;
  } catch (error) {
    const response = asErrorResponse(error, requestId);

    logRequest({
      ...target,
      occurredAt: new Date().toISOString(),
      requestId,
      status: response.status,
      // Undefined when requireAuth itself threw, which is the honest record: there
      // was no authenticated actor.
      actorId,
      errorCode: error instanceof AppError ? error.code : "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      durationMs: Date.now() - startedAt
    });

    return response;
  }
}
