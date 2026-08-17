import { AppError } from "./errors";
import { isSupportedTimeZone, UTC } from "./time-zone";

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
  /** The organization zone, an IANA name, e.g. `Asia/Manila`. Optional. */
  ORGANIZATION_TIME_ZONE?: string;
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
 * This deployment's **organization zone**, or `null` when none is configured.
 *
 * The zone QAMS speaks in when there is nobody to speak to — today, the stamps on a Jira
 * comment, read by people who are not QAMS users and have no preference QAMS could consult.
 * `CONTEXT.md` defines the term and
 * [ADR-0007](../../docs/adr/0007-a-zone-for-readers-and-a-zone-for-outsiders.md) records why
 * it is separate from a viewer's own zone, and why it deliberately governs no query.
 *
 * ## Why absent is legal and malformed is fatal
 *
 * Unset means UTC, so a deployment that upgrades into this renders byte-identically to how
 * it rendered before and only a deliberate act moves it — the same restraint
 * `JIRA_COMMENT_ON_FINALIZE` exercises, for the same reason: this changes the text of those
 * very comments.
 *
 * A value that is *present but unrecognised* **throws**, like `APP_BASE_URL` and unlike
 * `SESSION_TTL_HOURS`. The two failures are not symmetrical. A typo such as `Asia/Manilla`
 * that quietly fell back to UTC would make every Jira comment read eight hours off,
 * invisibly, in a project QAMS does not own — found by a stranger long after whoever typed
 * it could connect the two. That is precisely the failure this whole feature exists to
 * remove, so it must not be reachable through a misspelling.
 *
 * `src/instrumentation.ts` calls this at boot, so a typo stops the process while it is still
 * someone's deployment problem.
 */
export function organizationTimeZone(
  env: AppEnv & Record<string, string | undefined> = process.env
): string | null {
  const raw = present(env.ORGANIZATION_TIME_ZONE);
  if (raw === null) return null;

  if (!isSupportedTimeZone(raw)) {
    throw new AppError(
      500,
      "POLICY_NOT_DEFINED",
      `ORGANIZATION_TIME_ZONE must be an IANA zone name this runtime recognises, for example Asia/Manila. Received ${JSON.stringify(raw)}.`
    );
  }

  return raw;
}

/**
 * The zone one reader's stamps are rendered in: their own, else the organization's, else UTC.
 *
 * The chain is the whole design in one line, and it terminates at present behaviour — a
 * deployment that configures nothing and a person who chooses nothing see exactly what they
 * saw before this existed.
 *
 * `stored` is `User.timeZone`, where **null means "has never expressed a preference"** rather
 * than "chose the organization's". Only the former follows a deployment that later changes
 * its organization zone, which is why the column is nullable and was never backfilled.
 */
export function viewerTimeZone(
  stored: string | null,
  env: AppEnv & Record<string, string | undefined> = process.env
): string {
  return stored ?? organizationTimeZone(env) ?? UTC;
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

/**
 * The absolute URL of one defect's detail screen, or `null` when no base URL is configured.
 *
 * The counterpart of `executionUrl`, and addressed by UUID for the same reason: `/defects/[id]`
 * takes the UUID, not the `BUG-####` a person reads. It is what a Jira issue raised from a
 * defect links back to, so a developer reading the bug can reach the record QAMS holds.
 */
export function defectUrl(baseUrl: string | null, defectId: string): string | null {
  if (baseUrl === null) return null;
  return `${baseUrl}/defects/${encodeURIComponent(defectId)}`;
}
