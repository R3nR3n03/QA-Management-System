import { AppError } from "./errors";
import { parseEncryptionKey } from "./secret-box";

/**
 * Deployment configuration for the Jira execution sync
 * (`docs/api-and-security.md#Jira execution sync interface`).
 *
 * ## Why every value here is an environment variable and none is a screen
 *
 * These are connection SECRETS. `docs/api-and-security.md` requires secrets to live in
 * deployment-managed environment variables and never to be returned by an API — and a
 * settings screen is an API that returns its settings. Masking would not save it: a masked
 * field still confirms presence and length of the one class of data QAMS had never stored
 * before this feature. The admin screen shows whether Jira is connected and its base URL,
 * and nothing else.
 *
 * Pure, and the environment is injected, so the whole module is testable without setting a
 * single real variable — the same shape as `allowed-origins.ts` and the parsers in
 * `rate-limit.ts`.
 *
 * ## Partial configuration refuses to start
 *
 * An absent Jira configuration is NOT an error: a deployment that does not use Jira must
 * boot normally, with the integration simply off. But a HALF-configured one — a base URL and
 * a client ID with no secret — is a deployment mistake that would otherwise surface as
 * silently unsynced tickets weeks later. That fails at startup, naming every missing
 * variable at once so one restart fixes them all.
 */

/** The variables this module reads. Injected rather than read from `process.env` directly. */
export type JiraEnv = {
  JIRA_BASE_URL?: string;
  JIRA_OAUTH_CLIENT_ID?: string;
  JIRA_OAUTH_CLIENT_SECRET?: string;
  /** Where Jira sends the user back. Must match the OAuth app's registered callback. */
  JIRA_REDIRECT_URI?: string;
  /**
   * Base64, 32 bytes, encrypting stored refresh tokens (`src/lib/secret-box.ts`). Required
   * whenever Jira is configured: without it a connected account cannot be stored, and there
   * is no safe default — a generated key would make every stored credential undecryptable
   * on the next restart.
   */
  JIRA_ENCRYPTION_KEY?: string;
  /** Presence alone enables the service-account fallback. See `serviceAccountFallback`. */
  JIRA_SERVICE_ACCOUNT_TOKEN?: string;
  JIRA_TRANSITION_TIMEOUT_MS?: string;
};

/** The documented default, and the value used when an override is unusable. */
export const DEFAULT_JIRA_TRANSITION_TIMEOUT_MS = 5_000;

/** One variable per Jira project: `JIRA_TRANSITION_OVERRIDE_PROJ=31`. */
export const TRANSITION_OVERRIDE_PREFIX = "JIRA_TRANSITION_OVERRIDE_";

/** The three values without which no Jira call can be made. */
const REQUIRED_KEYS = [
  "JIRA_BASE_URL",
  "JIRA_OAUTH_CLIENT_ID",
  "JIRA_OAUTH_CLIENT_SECRET",
  "JIRA_REDIRECT_URI",
  "JIRA_ENCRYPTION_KEY"
] as const;

export type JiraConfig = {
  /** False when Jira is not configured at all; the integration is then inert. */
  enabled: boolean;
  baseUrl: string | null;
  clientId: string | null;
  clientSecret: string | null;
  /**
   * Whether a push may fall back to a service account when the triggering user's credential
   * is missing, expired or unauthorized.
   *
   * Derived from presence, not from a boolean flag, so the deployment decision and the
   * credential that makes it possible can never disagree. Unset means per-user OAuth only —
   * the QA Lead's original choice — and an expired token then strands the issue until a
   * person intervenes (ADR-0003).
   */
  serviceAccountFallback: boolean;
  serviceAccountToken: string | null;
  redirectUri: string | null;
  /** Decoded and length-checked at boot, so a bad key fails there rather than at connect. */
  encryptionKey: Buffer | null;
  timeoutMs: number;
  /** Jira project key -> transition id. Empty unless a deployment overrides one. */
  transitionOverrides: Map<string, string>;
};

function present(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Has this deployment said anything at all about Jira?
 *
 * True if ANY required value is present — deliberately, because the point is to distinguish
 * "not using Jira" from "configured it wrong". One value present means someone intended to
 * wire this up, so a missing sibling is a mistake rather than a choice.
 */
export function isJiraConfigured(env: JiraEnv): boolean {
  return REQUIRED_KEYS.some((key) => present(env[key]) !== null);
}

/**
 * One variable per project, discovered by prefix.
 *
 * Jira project keys are uppercase alphanumeric, which survives an environment variable name
 * intact, so the suffix IS the key. A blank value maps a project to nothing and is dropped
 * rather than stored; the bare prefix names no project at all.
 */
export function parseTransitionOverrides(env: Record<string, string | undefined>): Map<string, string> {
  const overrides = new Map<string, string>();

  for (const [name, raw] of Object.entries(env)) {
    if (!name.startsWith(TRANSITION_OVERRIDE_PREFIX)) continue;

    const projectKey = name.slice(TRANSITION_OVERRIDE_PREFIX.length);
    if (projectKey === "") continue;

    const value = present(raw);
    if (value === null) continue;

    overrides.set(projectKey, value);
  }

  return overrides;
}

/**
 * A positive integer, or the fallback.
 *
 * Falling back rather than throwing is safe here BECAUSE the default is the conservative
 * direction — a typo can fail to shorten the deadline, it can never remove it. The same
 * reasoning as `parsePositiveInteger` in `rate-limit.ts`, and the opposite of the required
 * keys above, where a missing value means no call can be made at all.
 */
function parseTimeout(raw: string | undefined): number {
  const value = present(raw);
  if (value === null) return DEFAULT_JIRA_TRANSITION_TIMEOUT_MS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_JIRA_TRANSITION_TIMEOUT_MS;
  return parsed;
}

/**
 * Reads and validates the configuration. Throws when it is present but incomplete.
 *
 * The throw is what "fail at boot" means: `src/instrumentation.ts` calls this once at
 * startup so a half-configured deployment stops there rather than discovering the gap on a
 * tester's first finalize.
 */
export function jiraConfig(env: JiraEnv & Record<string, string | undefined> = process.env): JiraConfig {
  if (!isJiraConfigured(env)) {
    return {
      enabled: false,
      baseUrl: null,
      clientId: null,
      clientSecret: null,
      serviceAccountFallback: false,
      serviceAccountToken: null,
      redirectUri: null,
      encryptionKey: null,
      timeoutMs: parseTimeout(env.JIRA_TRANSITION_TIMEOUT_MS),
      transitionOverrides: new Map()
    };
  }

  // Every gap at once: reporting them one restart at a time is a poor way to spend an
  // afternoon.
  const missing = REQUIRED_KEYS.filter((key) => present(env[key]) === null);
  if (missing.length > 0) {
    throw new AppError(
      500,
      "POLICY_NOT_DEFINED",
      `Jira integration is partly configured. Set ${missing.join(", ")}, or unset every JIRA_* variable to disable the integration.`
    );
  }

  const baseUrl = present(env.JIRA_BASE_URL) as string;
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw new AppError(
      500,
      "POLICY_NOT_DEFINED",
      "JIRA_BASE_URL must be an absolute http(s) URL, for example https://your-team.atlassian.net."
    );
  }

  const serviceAccountToken = present(env.JIRA_SERVICE_ACCOUNT_TOKEN);

  // Decoded here so a malformed key stops the process at boot rather than at the moment a
  // tester clicks Connect. `parseEncryptionKey` throws its own explanatory message.
  const encryptionKey = parseEncryptionKey(present(env.JIRA_ENCRYPTION_KEY) ?? undefined);

  return {
    enabled: true,
    baseUrl,
    clientId: present(env.JIRA_OAUTH_CLIENT_ID),
    clientSecret: present(env.JIRA_OAUTH_CLIENT_SECRET),
    serviceAccountFallback: serviceAccountToken !== null,
    serviceAccountToken,
    redirectUri: present(env.JIRA_REDIRECT_URI),
    encryptionKey,
    timeoutMs: parseTimeout(env.JIRA_TRANSITION_TIMEOUT_MS),
    transitionOverrides: parseTransitionOverrides(env)
  };
}

/**
 * What the admin screen may show: whether Jira is wired up, and where to.
 *
 * Deliberately carries no client id, no secret and no token — not even masked. This is the
 * projection a route handler is allowed to return.
 */
export function jiraConnectionStatus(env: JiraEnv & Record<string, string | undefined> = process.env): {
  connected: boolean;
  baseUrl: string | null;
  serviceAccountFallback: boolean;
} {
  const config = jiraConfig(env);
  return {
    connected: config.enabled,
    baseUrl: config.baseUrl,
    serviceAccountFallback: config.serviceAccountFallback
  };
}
