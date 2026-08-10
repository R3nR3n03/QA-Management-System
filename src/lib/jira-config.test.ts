import { describe, expect, it } from "vitest";
import { AppError } from "./errors";
import {
  isJiraConfigured,
  jiraConfig,
  parseTransitionOverrides,
  type JiraEnv
} from "./jira-config";

const complete: JiraEnv = {
  JIRA_BASE_URL: "https://acme.atlassian.net",
  JIRA_OAUTH_CLIENT_ID: "client-abc",
  JIRA_OAUTH_CLIENT_SECRET: "secret-xyz"
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
    ["JIRA_BASE_URL"]
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
