import { AppError } from "./errors";

/**
 * Where this QAMS deployment lives, as seen from outside it.
 *
 * ## Why this is not in `jira-config.ts`
 *
 * Its only reader today is the Jira result comment, which links back to the run it reports
 * (`docs/architecture.md#Jira execution sync`). It is still not a Jira value: it is this
 * application's own public address, and the next thing that needs to address a QAMS page from
 * outside — a notification, a digest, an export — would want the same variable. Filing it
 * under a module whose subject is a third-party integration would make it findable only by
 * someone already looking at Jira.
 *
 * ## Why it is optional
 *
 * QAMS has never needed to know its own origin: every link it renders is relative, which is
 * why nothing has ever asked for this. A deployment that does not set it simply gets a result
 * comment with no link, which is a smaller loss than a link that goes somewhere wrong.
 *
 * Pure, with the environment injected, like `jira-config.ts` and `rate-limit.ts`.
 */

export type AppEnv = {
  /** The public origin, e.g. `https://qams.example.com`. Optional. */
  APP_BASE_URL?: string;
};

function present(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * The configured public origin, or `null` when there is none.
 *
 * A value that is present but not an absolute `http(s)` URL **throws**, rather than being
 * quietly treated as absent. The two failures are not symmetrical: no value means no link,
 * which a reader can see; a malformed one means a link rendered into someone else's Jira
 * ticket that leads nowhere, discovered by a stranger long after whoever typed it could
 * connect the two. `src/instrumentation.ts` calls this at boot so a typo stops the process
 * while it is still someone's deployment problem — the same contract `jiraConfig()` has for a
 * half-configured integration.
 */
export function appBaseUrl(env: AppEnv & Record<string, string | undefined> = process.env): string | null {
  const raw = present(env.APP_BASE_URL);
  if (raw === null) return null;

  if (!/^https?:\/\//i.test(raw)) {
    throw new AppError(
      500,
      "POLICY_NOT_DEFINED",
      "APP_BASE_URL must be an absolute http(s) URL, for example https://qams.example.com."
    );
  }

  // Trimmed rather than assumed absent: this is hand-written into an environment file, and
  // `https://host/` + `/executions` is a double slash some reverse proxies answer with a
  // redirect or a 404. Same reasoning as `jiraIssueUrl`.
  return raw.replace(/\/+$/, "");
}

/**
 * The absolute URL of one run's detail screen, or `null` when no base URL is configured.
 *
 * Deciding the "there is nowhere to link to" branch once, here, is what lets a caller ask a
 * single question and either have a link or not — the shape `jiraIssueUrl` already uses for
 * the same problem in the other direction.
 *
 * The id is the execution's UUID, because `/executions/[id]` is addressed by UUID and not by
 * the `EXE-####` business ID a person reads.
 */
export function executionUrl(baseUrl: string | null, executionId: string): string | null {
  if (baseUrl === null) return null;
  return `${baseUrl}/executions/${encodeURIComponent(executionId)}`;
}
