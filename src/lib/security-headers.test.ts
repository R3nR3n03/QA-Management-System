import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy, securityHeaders } from "./security-headers";

describe("securityHeaders", () => {
  it("always sets the four request-invariant headers", () => {
    for (const isProduction of [true, false]) {
      const headers = securityHeaders({ isProduction });
      expect(headers["X-Content-Type-Options"]).toBe("nosniff");
      expect(headers["X-Frame-Options"]).toBe("DENY");
      expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
      expect(headers["Permissions-Policy"]).toBe(
        "camera=(), microphone=(), geolocation=(), interest-cohort=()"
      );
    }
  });

  /**
   * HSTS is sticky for its whole max-age. Emitting it from a local http dev server pins
   * https on localhost in the developer's browser for two years, with no way to serve it
   * back. Production only, deliberately.
   */
  it("sends HSTS in production and never outside it", () => {
    expect(securityHeaders({ isProduction: true })["Strict-Transport-Security"]).toBe(
      "max-age=63072000; includeSubDomains"
    );
    expect(securityHeaders({ isProduction: false })["Strict-Transport-Security"]).toBeUndefined();
  });
});

describe("buildContentSecurityPolicy", () => {
  const production = buildContentSecurityPolicy({ nonce: "abc123", isProduction: true });
  const development = buildContentSecurityPolicy({ nonce: "abc123", isProduction: false });

  it("nonces the script source and lets it bootstrap its own chunks", () => {
    expect(production).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
  });

  /**
   * Next's dev HMR and React refresh evaluate code at runtime, so dev needs 'unsafe-eval'.
   * A production build that needed it would mean something is wrong with the build, not
   * with this policy — so this assertion is the tripwire for that.
   */
  it("allows eval only outside production", () => {
    expect(development).toContain("'unsafe-eval'");
    expect(production).not.toContain("'unsafe-eval'");
  });

  /**
   * Known and accepted: 52 React inline style={{}} usages render as style ATTRIBUTES, which
   * a nonce cannot cover. Dropping 'unsafe-inline' renders the UI unstyled. The follow-up is
   * to move them into globals.css; until then this line is the weakest in the policy — but
   * it must never spread to script-src, which is where session theft lives.
   */
  it("permits inline styles but never inline scripts", () => {
    expect(production).toContain("style-src 'self' 'unsafe-inline'");
    expect(production).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(development).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  it("locks down the remaining fetch and navigation directives", () => {
    for (const directive of [
      "default-src 'self'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ]) {
      expect(production).toContain(directive);
    }
  });

  it("emits one semicolon-separated header value", () => {
    expect(production.startsWith("default-src 'self'; ")).toBe(true);
    expect(production.endsWith("frame-ancestors 'none'")).toBe(true);
    expect(production).not.toContain(";;");
  });

  it("carries the nonce it was given, so each request differs", () => {
    expect(buildContentSecurityPolicy({ nonce: "one", isProduction: true })).toContain(
      "'nonce-one'"
    );
    expect(buildContentSecurityPolicy({ nonce: "two", isProduction: true })).toContain(
      "'nonce-two'"
    );
  });
});
