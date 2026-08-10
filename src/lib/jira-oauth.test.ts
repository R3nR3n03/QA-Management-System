import { describe, expect, it } from "vitest";
import { authorizeUrl, parseTokenResponse } from "./jira-oauth";

const config = {
  clientId: "client-abc",
  redirectUri: "https://qams.example.com/api/v1/jira/callback"
};

describe("authorizeUrl", () => {
  const url = () => new URL(authorizeUrl(config.clientId, config.redirectUri, "state-123"));

  it("points at Atlassian's consent endpoint", () => {
    expect(url().origin + url().pathname).toBe("https://auth.atlassian.com/authorize");
  });

  it("carries the client id, redirect and state", () => {
    const params = url().searchParams;
    expect(params.get("client_id")).toBe(config.clientId);
    expect(params.get("redirect_uri")).toBe(config.redirectUri);
    expect(params.get("state")).toBe("state-123");
    expect(params.get("response_type")).toBe("code");
  });

  // offline_access is what yields a refresh token. Without it the connection would die in
  // an hour and the retry queue could never replay as that person.
  it("requests offline access and permission to transition an issue", () => {
    const scope = url().searchParams.get("scope") ?? "";
    expect(scope).toContain("offline_access");
    expect(scope).toContain("write:jira-work");
  });

  it("escapes a state that would otherwise break the query string", () => {
    const built = new URL(authorizeUrl(config.clientId, config.redirectUri, "a b&c=d"));
    expect(built.searchParams.get("state")).toBe("a b&c=d");
  });
});

describe("parseTokenResponse", () => {
  it("reads the refresh token", () => {
    expect(parseTokenResponse({ access_token: "at", refresh_token: "rt", expires_in: 3600 })).toBe(
      "rt"
    );
  });

  // The single seam that a stub cannot prove: whether Jira's real body matches this shape.
  // Everything it can get wrong must therefore fail loudly rather than store an empty token.
  it.each<[unknown, string]>([
    [{ access_token: "at" }, "no refresh token"],
    [{ refresh_token: "" }, "blank refresh token"],
    [{ refresh_token: 42 }, "non-string refresh token"],
    [{}, "empty body"],
    [null, "null body"],
    ["not json", "non-object body"]
  ])("refuses a response with %s", (body) => {
    expect(() => parseTokenResponse(body)).toThrow();
  });

  it("surfaces an OAuth error body rather than reporting a missing token", () => {
    expect(() =>
      parseTokenResponse({ error: "invalid_grant", error_description: "code expired" })
    ).toThrow(/invalid_grant/);
  });
});
