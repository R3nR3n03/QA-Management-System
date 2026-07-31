import { AppError } from "@/lib/errors";
import { requireAuth } from "@/lib/auth";
import { logRequest } from "@/lib/logging";
import { mapPrismaError } from "@/lib/prisma-errors";
import { requestMetadata } from "@/lib/request-metadata";
import { errorCopy, type ErrorCopy } from "./error-copy";

/**
 * The server-action counterpart to `withRoute` (`src/lib/route.ts`).
 *
 * Same contract as a route handler — authenticate, then call ONE domain service —
 * with one difference: a screen cannot render an HTTP status, so this *returns* the
 * failure instead of throwing it, already translated into copy the page can show
 * next to the field that caused it.
 *
 * The domain services stay the single enforcement point. Nothing here validates,
 * authorizes or persists; it only carries the actor in and the result out.
 */

export type ActionOk<T> = { ok: true; data: T };
export type ActionFail = {
  ok: false;
  code: string;
  field?: string;
  /** The developer-facing message from AppError. Not rendered to users. */
  message: string;
  /** Shown to the user. */
  copy: ErrorCopy;
  /** Echoed on INTERNAL_ERROR so a report can be tied to a log line. */
  requestId: string;
};
export type ActionResult<T> = ActionOk<T> | ActionFail;

export type ActionActor = {
  userId: string;
  role: import("@prisma/client").QamsRole;
  requestId: string;
};

/**
 * Runs `fn` with an authenticated actor, converting a thrown `AppError` into a
 * renderable failure. Anything else becomes INTERNAL_ERROR — the underlying error
 * is deliberately not surfaced, per `docs/api-and-security.md:33` ("Do not expose
 * stack traces, SQL details, authorization rules, or internal identifiers").
 *
 * Every outcome is logged, with the same shape `withRoute` emits, so a screen and an
 * API call that hit the same domain failure produce comparable lines. The
 * `requestId` shown to the user on an INTERNAL_ERROR is the one in the log.
 */
/**
 * The shape every screen form renders after a submit: nothing on success, the
 * translated error copy on failure. Shared so each screen's server action is only
 * "read the form, call one domain service, revalidate".
 */
export type FormState = {
  title: string;
  detail: string;
  field?: string;
  requestId?: string;
  advisory?: boolean;
  /** A confirmation, not a failure — rendered calmly, and forms may reset on it. */
  success?: boolean;
} | null;

/** Convert a failed ActionResult into the renderable form state. */
export function failState(result: ActionFail): NonNullable<FormState> {
  return {
    title: result.copy.title,
    detail: result.copy.detail,
    field: result.field,
    requestId: result.code === "INTERNAL_ERROR" ? result.requestId : undefined,
    advisory: result.copy.advisory
  };
}

export async function runAction<T>(
  fn: (actor: ActionActor) => Promise<T>
): Promise<ActionResult<T>> {
  const startedAt = Date.now();
  const { requestId } = await requestMetadata();
  let actorId: string | undefined;

  try {
    const auth = await requireAuth();
    actorId = auth.userId;
    const data = await fn({ userId: auth.userId, role: auth.role, requestId });

    logRequest({
      occurredAt: new Date().toISOString(),
      requestId,
      status: 200,
      actorId,
      action: "SERVER_ACTION",
      durationMs: Date.now() - startedAt
    });

    return { ok: true, data };
  } catch (error) {
    const isApp = error instanceof AppError;
    // Same B2 translation the API boundary does, so a database constraint reads the same
    // whether it was hit through a screen or through `/api/v1`. Without this a raced
    // duplicate ID renders as "Something broke on our side" — which is both wrong and
    // unactionable, when the useful sentence is "that ID is already taken".
    const mapped = isApp ? null : mapPrismaError(error);

    logRequest({
      occurredAt: new Date().toISOString(),
      requestId,
      status: isApp ? error.status : (mapped?.status ?? 500),
      actorId,
      action: "SERVER_ACTION",
      errorCode: isApp ? error.code : (mapped?.code ?? "INTERNAL_ERROR"),
      // The ORIGINAL error text, including Prisma's, stays in the log — it is the developer
      // record. Only the caller is given the fixed message.
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      durationMs: Date.now() - startedAt
    });

    if (isApp) {
      return {
        ok: false,
        code: error.code,
        field: error.field,
        message: error.message,
        copy: errorCopy(error.code, error.field),
        requestId
      };
    }

    if (mapped) {
      return {
        ok: false,
        code: mapped.code,
        field: mapped.field,
        message: mapped.message,
        copy: errorCopy(mapped.code, mapped.field),
        requestId
      };
    }

    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: "Unexpected error.",
      copy: errorCopy("INTERNAL_ERROR"),
      requestId
    };
  }
}
