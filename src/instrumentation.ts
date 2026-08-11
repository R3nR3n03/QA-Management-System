import { logRequest } from "@/lib/logging";

/**
 * Startup checks. Next calls `register()` once per server process, before any request.
 *
 * ## Why the Jira configuration is validated here
 *
 * A half-configured integration — a base URL and a client id with no secret — otherwise
 * looks like it works and silently never syncs, and the gap surfaces weeks later as tickets
 * that were never transitioned. `jiraConfig()` throws on that, and throwing from here stops
 * the process at boot with a message naming every missing variable.
 *
 * An ABSENT configuration is not a failure. A deployment that does not use Jira boots
 * normally with the integration inert; only a partial one is a mistake worth refusing to
 * start for.
 *
 * ## Why this file sits in `src/`
 *
 * Next looks for it beside the routing directory, and this project keeps its app in
 * `src/app`. At the repository root it would be silently ignored — the same trap
 * documented at length in `src/middleware.ts`.
 */
export async function register(): Promise<void> {
  // `register()` runs once per runtime, and this project's Jira config is Node-only. The
  // Edge copy would repeat the work and the log line for no benefit.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Imported dynamically so the Edge runtime never pulls it in at module load.
  const { jiraConfig } = await import("@/lib/jira-config");
  const { appBaseUrl } = await import("@/lib/app-config");

  // Throws on a partly configured integration. Deliberately not caught: that is the
  // "fail at boot" contract.
  const config = jiraConfig();

  // Same contract, for the same reason. An absent APP_BASE_URL is fine — a result comment
  // then carries no link — but a malformed one would render a dead link into someone else's
  // Jira ticket, found by a stranger weeks after whoever typed it could connect the two.
  const baseUrl = appBaseUrl();

  // The Jira transport is deliberately NOT installed here. It reaches `src/lib/db.ts`, which
  // constructs PrismaPg at module scope and pulls in `pg` and `node:fs` — and this file is
  // compiled for the Edge runtime as well as Node, where none of that resolves. A dynamic
  // import does not save it: webpack resolves the module graph at build time regardless of
  // the runtime guard above. The same trap `src/middleware.ts` documents, and the same one
  // `jira-config.ts` hit with `node:crypto`.
  //
  // It is installed lazily on first use instead, from `settleJiraSync` in
  // `src/domain/executions.ts`, which is Node-only and already talks to the database.

  logRequest({
    occurredAt: new Date().toISOString(),
    requestId: "startup",
    status: 200,
    action: "JIRA_CONFIG_LOADED",
    message: config.enabled
      ? `Jira execution sync enabled for ${config.baseUrl}; service-account fallback ${config.serviceAccountFallback ? "enabled" : "disabled"}; ${config.transitionOverrides.size} transition override(s); result comments ${config.commentOnFinalize ? "on" : "off"}${config.commentOnFinalize && baseUrl === null ? " (no APP_BASE_URL, so comments carry no link)" : ""}.`
      : "Jira execution sync disabled: no JIRA_* configuration present."
  });
}
