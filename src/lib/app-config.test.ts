import { describe, expect, it } from "vitest";
import { appBaseUrl, executionUrl, organizationTimeZone, viewerTimeZone } from "./app-config";
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

describe("organizationTimeZone", () => {
  it("is null when the deployment has not set one", () => {
    expect(organizationTimeZone({})).toBeNull();
    expect(organizationTimeZone({ ORGANIZATION_TIME_ZONE: "   " })).toBeNull();
  });

  it("returns a recognised IANA zone", () => {
    expect(organizationTimeZone({ ORGANIZATION_TIME_ZONE: "Asia/Manila" })).toBe("Asia/Manila");
    expect(organizationTimeZone({ ORGANIZATION_TIME_ZONE: "UTC" })).toBe("UTC");
  });

  /**
   * A misspelling must stop the process, not degrade to UTC.
   *
   * Falling back would make every stamp QAMS writes into someone else's Jira project read
   * eight hours off, invisibly — the exact failure this setting exists to remove, reachable
   * through a doubled letter. Same contract as `APP_BASE_URL` above, for the same reason
   * (ADR-0007).
   */
  it("refuses a zone name the runtime does not recognise", () => {
    expect(() => organizationTimeZone({ ORGANIZATION_TIME_ZONE: "Asia/Manilla" })).toThrow(AppError);
    expect(() => organizationTimeZone({ ORGANIZATION_TIME_ZONE: "+08:00" })).toThrow(AppError);
    expect(() => organizationTimeZone({ ORGANIZATION_TIME_ZONE: "PHT" })).toThrow(AppError);
  });
});

describe("viewerTimeZone", () => {
  // Their own zone, else the organization's, else UTC — and the chain terminates at what an
  // untouched deployment rendered before any of this existed.
  it("prefers the viewer's own choice", () => {
    expect(viewerTimeZone("Europe/Berlin", { ORGANIZATION_TIME_ZONE: "Asia/Manila" })).toBe(
      "Europe/Berlin"
    );
  });

  it("falls back to the organization zone when the viewer has chosen none", () => {
    expect(viewerTimeZone(null, { ORGANIZATION_TIME_ZONE: "Asia/Manila" })).toBe("Asia/Manila");
  });

  it("falls back to UTC when neither is set", () => {
    expect(viewerTimeZone(null, {})).toBe("UTC");
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
