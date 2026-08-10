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

  // Throws on a partly configured integration. Deliberately not caught: that is the
  // "fail at boot" contract.
  const config = jiraConfig();

  logRequest({
    occurredAt: new Date().toISOString(),
    requestId: "startup",
    status: 200,
    action: "JIRA_CONFIG_LOADED",
    message: config.enabled
      ? `Jira execution sync enabled for ${config.baseUrl}; service-account fallback ${config.serviceAccountFallback ? "enabled" : "disabled"}; ${config.transitionOverrides.size} transition override(s).`
      : "Jira execution sync disabled: no JIRA_* configuration present."
  });
}
