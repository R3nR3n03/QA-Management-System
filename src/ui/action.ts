import { AppError } from "@/lib/errors";
import { requireAuth } from "@/lib/auth";
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
 * KNOWN GAP: the caught error is discarded rather than logged, because the project
 * has no structured logging (audit section 3.6). The `requestId` returned here is
 * therefore shown to the user but currently correlates with nothing. Fixing 3.6
 * closes that loop.
 */
export async function runAction<T>(
  fn: (actor: ActionActor) => Promise<T>
): Promise<ActionResult<T>> {
  const { requestId } = await requestMetadata();
  try {
    const auth = await requireAuth();
    const data = await fn({ userId: auth.userId, role: auth.role, requestId });
    return { ok: true, data };
  } catch (error) {
    if (error instanceof AppError) {
      return {
        ok: false,
        code: error.code,
        field: error.field,
        message: error.message,
        copy: errorCopy(error.code, error.field),
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
