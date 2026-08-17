import { describe, expect, it } from "vitest";
import { AppError } from "./errors";
import {
  isJiraConfigured,
  jiraConfig,
  jiraIssueUrl,
  parseTransitionOverrides,
  type JiraEnv
} from "./jira-config";

const complete: JiraEnv = {
  JIRA_BASE_URL: "https://acme.atlassian.net",
  JIRA_OAUTH_CLIENT_ID: "client-abc",
  JIRA_OAUTH_CLIENT_SECRET: "secret-xyz",
  JIRA_REDIRECT_URI: "https://qams.example.com/api/v1/jira/callback",
  JIRA_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64")
};

describe("isJiraConfigured", () => {
  // Absent config is not an error: a deployment that does not use Jira must still boot.
  it("is false when nothing is set", () => {
    expect(isJiraConfigured({})).toBe(false);
  });

  it("is true when every required value is present", () => {
    expect(isJiraConfigured(complete)).toBe(true);
  });

  it("is true when only some values are present, so the gap is reported rather than ignored", () => {
    expect(isJiraConfigured({ JIRA_BASE_URL: complete.JIRA_BASE_URL })).toBe(true);
  });

  it("treats blank values as absent", () => {
    expect(isJiraConfigured({ JIRA_BASE_URL: "   ", JIRA_OAUTH_CLIENT_ID: "" })).toBe(false);
  });
});

describe("jiraConfig", () => {
  it("returns a disabled config when Jira is not configured at all", () => {
    const config = jiraConfig({});
    expect(config.enabled).toBe(false);
    expect(config.baseUrl).toBeNull();
  });

  it("returns the parsed config when complete", () => {
    const config = jiraConfig(complete);
    expect(config.enabled).toBe(true);
    expect(config.baseUrl).toBe("https://acme.atlassian.net");
    expect(config.clientId).toBe("client-abc");
  });

  // Q5: partial configuration is a deployment mistake and must not boot.
  it.each([
    ["JIRA_OAUTH_CLIENT_SECRET"],
    ["JIRA_OAUTH_CLIENT_ID"],
    ["JIRA_BASE_URL"],
    ["JIRA_REDIRECT_URI"],
    ["JIRA_ENCRYPTION_KEY"]
  ])("refuses to start when %s is missing but Jira is otherwise configured", (missing) => {
    const partial = { ...complete };
    delete partial[missing as keyof JiraEnv];
    expect(() => jiraConfig(partial)).toThrowError(AppError);
  });

  it("names every missing variable in the failure, so one restart fixes all of them", () => {
    try {
      jiraConfig({ JIRA_BASE_URL: complete.JIRA_BASE_URL });
      expect.unreachable("should have thrown");
    } catch (error) {
      const message = (error as AppError).message;
      expect(message).toContain("JIRA_OAUTH_CLIENT_ID");
      expect(message).toContain("JIRA_OAUTH_CLIENT_SECRET");
    }
  });

  // The key is decoded at boot so a bad one fails there, not when a tester clicks Connect.
  it("rejects an encryption key that is not 32 bytes", () => {
    expect(() =>
      jiraConfig({ ...complete, JIRA_ENCRYPTION_KEY: Buffer.alloc(16, 3).toString("base64") })
    ).toThrow();
  });

  // Kept as the raw base64 string: decoding needs node:crypto, and this module is reachable
  // from the Edge runtime through instrumentation.ts.
  it("keeps the encryption key as base64 without decoding it", () => {
    expect(jiraConfig(complete).encryptionKey).toBe(complete.JIRA_ENCRYPTION_KEY);
  });

  it("rejects an encryption key that is not base64", () => {
    expect(() => jiraConfig({ ...complete, JIRA_ENCRYPTION_KEY: "not base64 !!!" })).toThrow();
  });

  it("rejects a base URL that is not http(s)", () => {
    expect(() => jiraConfig({ ...complete, JIRA_BASE_URL: "acme.atlassian.net" })).toThrowError(
      AppError
    );
  });

  // Q7: the service-account fallback exists only where one is configured. Unset means
  // per-user OAuth only, which is what the QA Lead originally chose.
  it("has no service-account fallback unless a token is configured", () => {
    expect(jiraConfig(complete).serviceAccountFallback).toBe(false);
  });

  it("enables the fallback when a service-account token is configured", () => {
    const config = jiraConfig({ ...complete, JIRA_SERVICE_ACCOUNT_TOKEN: "svc-token" });
    expect(config.serviceAccountFallback).toBe(true);
  });

  it("uses the documented default timeout when none is set", () => {
    expect(jiraConfig(complete).timeoutMs).toBe(5_000);
  });

  it("takes a valid timeout override", () => {
    expect(jiraConfig({ ...complete, JIRA_TRANSITION_TIMEOUT_MS: "1500" }).timeoutMs).toBe(1500);
  });

  it("falls back to the default on an unusable timeout rather than failing", () => {
    expect(jiraConfig({ ...complete, JIRA_TRANSITION_TIMEOUT_MS: "0" }).timeoutMs).toBe(5_000);
    expect(jiraConfig({ ...complete, JIRA_TRANSITION_TIMEOUT_MS: "nope" }).timeoutMs).toBe(5_000);
  });

  // A deployment already connected to Jira for transitions must not start writing into its
  // tickets because it upgraded (ADR-0004).
  it("does not post result comments unless a deployment opts in", () => {
    expect(jiraConfig(complete).commentOnFinalize).toBe(false);
  });

  it("posts result comments when the flag is set", () => {
    expect(jiraConfig({ ...complete, JIRA_COMMENT_ON_FINALIZE: "true" }).commentOnFinalize).toBe(true);
    expect(jiraConfig({ ...complete, JIRA_COMMENT_ON_FINALIZE: "YES" }).commentOnFinalize).toBe(true);
    expect(jiraConfig({ ...complete, JIRA_COMMENT_ON_FINALIZE: "1" }).commentOnFinalize).toBe(true);
  });

  // The safe direction: a typo can fail to enable the feature, it can never enable it.
  it("stays off for anything that is not a recognised affirmative", () => {
    expect(jiraConfig({ ...complete, JIRA_COMMENT_ON_FINALIZE: "false" }).commentOnFinalize).toBe(false);
    expect(jiraConfig({ ...complete, JIRA_COMMENT_ON_FINALIZE: "ture" }).commentOnFinalize).toBe(false);
    expect(jiraConfig({ ...complete, JIRA_COMMENT_ON_FINALIZE: "  " }).commentOnFinalize).toBe(false);
  });

  // Nowhere to post: reporting the flag as on would describe a capability that does not exist.
  it("reports no commenting when Jira is not configured at all", () => {
    expect(jiraConfig({ JIRA_COMMENT_ON_FINALIZE: "true" }).commentOnFinalize).toBe(false);
  });

  // ADR-0006. `Bug` is Jira's own default name and exists in every stock project, so a
  // deployment that has not renamed its issue types configures nothing here.
  it("defaults the issue type to Bug", () => {
    expect(jiraConfig(complete).defectIssueType).toBe("Bug");
  });

  it("takes an issue type override for a site that renamed it", () => {
    expect(jiraConfig({ ...complete, JIRA_DEFECT_ISSUE_TYPE: "Defect" }).defectIssueType).toBe("Defect");
  });

  // The project a product's bugs go to is catalogue data on `Product.jiraProjectKey`, not
  // deployment configuration. A deployment that still sets the retired variable is not
  // half-configured and must not be treated as such — the value is simply ignored.
  it("ignores a retired JIRA_DEFECT_PROJECT_KEY rather than failing on it", () => {
    const config = jiraConfig({ ...complete, JIRA_DEFECT_PROJECT_KEY: "BUG" } as JiraEnv);
    expect(config.enabled).toBe(true);
    expect(config).not.toHaveProperty("defectProjectKey");
  });

  it("does not treat the retired variable as intent to use Jira", () => {
    // Alone, it says nothing: this deployment has no Jira connection at all, and reporting it
    // as half-configured would demand five variables to fix a value nothing reads.
    expect(isJiraConfigured({ JIRA_DEFECT_PROJECT_KEY: "BUG" } as JiraEnv)).toBe(false);
    expect(jiraConfig({ JIRA_DEFECT_PROJECT_KEY: "BUG" } as JiraEnv).enabled).toBe(false);
  });
});

/**
 * The deep link a screen renders for an execution's issue key.
 *
 * Null is the whole not-configured branch, decided once here rather than at each call site:
 * a deployment with no `JIRA_BASE_URL` still records issue keys, and those runs show the key
 * as plain text with nowhere to send the reader.
 */
describe("jiraIssueUrl", () => {
  it("builds Jira's browse URL for a key", () => {
    expect(jiraIssueUrl("https://acme.atlassian.net", "PROJ-123")).toBe(
      "https://acme.atlassian.net/browse/PROJ-123"
    );
  });

  // JIRA_BASE_URL is written by hand into an environment file, so both spellings arrive.
  it("tolerates a trailing slash on the base URL", () => {
    expect(jiraIssueUrl("https://acme.atlassian.net/", "PROJ-123")).toBe(
      "https://acme.atlassian.net/browse/PROJ-123"
    );
    expect(jiraIssueUrl("https://acme.atlassian.net///", "PROJ-123")).toBe(
      "https://acme.atlassian.net/browse/PROJ-123"
    );
  });

  it("keeps a base URL that already has a path", () => {
    expect(jiraIssueUrl("https://example.com/jira/", "PROJ-123")).toBe(
      "https://example.com/jira/browse/PROJ-123"
    );
  });

  it("has no URL to offer when Jira is not configured", () => {
    expect(jiraIssueUrl(null, "PROJ-123")).toBeNull();
    expect(jiraIssueUrl("   ", "PROJ-123")).toBeNull();
  });

  it("has no URL to offer for a run carrying no key", () => {
    expect(jiraIssueUrl("https://acme.atlassian.net", null)).toBeNull();
    expect(jiraIssueUrl("https://acme.atlassian.net", "  ")).toBeNull();
  });

  /**
   * Every stored key is pattern-valid (`normalizeJiraIssueKey`), so encoding changes nothing
   * about a real one. It is here because this value reaches an `href`, and a path separator
   * arriving from the database must not be able to retarget the link.
   */
  it("encodes a key rather than letting it change the path", () => {
    expect(jiraIssueUrl("https://acme.atlassian.net", "PROJ-1/../secret")).toBe(
      "https://acme.atlassian.net/browse/PROJ-1%2F..%2Fsecret"
    );
  });
});

// Q4(b): one variable per Jira project, discovered by prefix.
describe("parseTransitionOverrides", () => {
  it("finds nothing when no override is set", () => {
    expect(parseTransitionOverrides({})).toEqual(new Map());
  });

  it("reads the project key from the variable suffix", () => {
    expect(parseTransitionOverrides({ JIRA_TRANSITION_OVERRIDE_PROJ: "31" })).toEqual(
      new Map([["PROJ", "31"]])
    );
  });

  it("reads several projects", () => {
    const overrides = parseTransitionOverrides({
      JIRA_TRANSITION_OVERRIDE_PROJ: "31",
      JIRA_TRANSITION_OVERRIDE_ACME: "41"
    });
    expect(overrides.get("PROJ")).toBe("31");
    expect(overrides.get("ACME")).toBe("41");
  });

  it("supports a project key containing digits", () => {
    expect(parseTransitionOverrides({ JIRA_TRANSITION_OVERRIDE_AB1: "7" }).get("AB1")).toBe("7");
  });

  it("ignores unrelated variables", () => {
    expect(parseTransitionOverrides({ JIRA_BASE_URL: "x", DATABASE_URL: "y" })).toEqual(new Map());
  });

  it("ignores a blank override rather than mapping a project to nothing", () => {
    expect(parseTransitionOverrides({ JIRA_TRANSITION_OVERRIDE_PROJ: "  " })).toEqual(new Map());
  });

  // The bare prefix names no project, so it cannot be an override for one.
  it("ignores the bare prefix with no project suffix", () => {
    expect(parseTransitionOverrides({ JIRA_TRANSITION_OVERRIDE_: "31" })).toEqual(new Map());
  });
});
