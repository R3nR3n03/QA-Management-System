import { QamsRole } from "@prisma/client";
import { runJiraSyncRetries } from "@/domain/jira-retry";
import { AppError } from "@/lib/errors";
import { withRoute } from "@/lib/route";

/**
 * Works the Jira retry queue once.
 *
 * ## Why this is an endpoint rather than a timer
 *
 * Next.js has no scheduler, and a `setInterval` inside a request-handling process is worse
 * than none: it runs once per instance rather than once per deployment, keeps running while
 * the process is draining, and has nowhere to report failure. An endpoint makes the schedule
 * an operational decision — a cron job, a platform scheduler, or a person — and it is
 * observable and repeatable by hand when something has gone wrong.
 *
 * ## Authorization
 *
 * QA Lead only, on the existing session. Deliberately NOT a shared secret in a header: this
 * project already has one authentication mechanism with a documented role model, and adding
 * a second credential to configure and rotate for one endpoint is how deployments drift.
 * A scheduler that cannot hold a session can call it as a QA Lead service user.
 *
 * Safe to call at any interval and safe to call twice: an issue that has been settled leaves
 * the queue, and `MAX_SYNC_ATTEMPTS` bounds how long a failing one stays in it.
 */
export async function POST(request: Request) {
  return withRoute(request, async ({ auth }) => {
    if (auth.role !== QamsRole.QA_LEAD) {
      throw new AppError(403, "UNAUTHORIZED", "Only a QA Lead may run the Jira retry queue.");
    }

    const summary = await runJiraSyncRetries();
    return Response.json(summary);
  });
}
