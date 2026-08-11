import { describe, expect, it } from "vitest";
import { appBaseUrl, executionUrl } from "./app-config";
import { AppError } from "./errors";

describe("appBaseUrl", () => {
  it("is null when the deployment has not set one", () => {
    expect(appBaseUrl({})).toBeNull();
    expect(appBaseUrl({ APP_BASE_URL: "   " })).toBeNull();
  });

  it("returns an absolute URL with trailing slashes trimmed", () => {
    expect(appBaseUrl({ APP_BASE_URL: "https://qams.example.com/" })).toBe("https://qams.example.com");
    expect(appBaseUrl({ APP_BASE_URL: "http://localhost:3000" })).toBe("http://localhost:3000");
  });

  // A typo here would otherwise surface as a link in someone else's Jira ticket that goes
  // nowhere, long after whoever set it could connect the two.
  it("refuses a value that is not an absolute http(s) URL", () => {
    expect(() => appBaseUrl({ APP_BASE_URL: "qams.example.com" })).toThrow(AppError);
    expect(() => appBaseUrl({ APP_BASE_URL: "/executions" })).toThrow(AppError);
  });
});

describe("executionUrl", () => {
  it("addresses one run", () => {
    expect(executionUrl("https://qams.example.com", "abc-123")).toBe(
      "https://qams.example.com/executions/abc-123"
    );
  });

  // The single place the "no base URL configured" branch is decided, so callers ask once and
  // either have a link or do not.
  it("is null when there is no base URL to build on", () => {
    expect(executionUrl(null, "abc-123")).toBeNull();
  });
});
