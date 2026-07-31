import { describe, expect, it } from "vitest";
import { AppError } from "./errors";
import {
  DEFAULT_MAX_UPLOAD_BYTES,
  assertWithinUploadLimit,
  exceedsUploadLimit,
  formatBytes,
  headerContentLength,
  maxUploadBytes,
  parseMaxUploadBytes
} from "./upload-limits";

describe("parseMaxUploadBytes", () => {
  it("uses a configured integer byte count", () => {
    expect(parseMaxUploadBytes("2048")).toBe(2048);
    expect(parseMaxUploadBytes("1")).toBe(1);
  });

  /**
   * A misconfiguration must never WIDEN the limit. Every rejected input falls back
   * to the default, which is the restrictive direction — a typo can fail to narrow
   * the gate, it can never open it.
   */
  it("falls back to the default for anything unusable, never to unlimited", () => {
    for (const bad of [undefined, "", "   ", "abc", "10MB", "0", "-1", "1.5", "NaN", "Infinity"]) {
      expect(parseMaxUploadBytes(bad)).toBe(DEFAULT_MAX_UPLOAD_BYTES);
    }
  });

  it("reads MAX_UPLOAD_BYTES from the supplied environment", () => {
    expect(maxUploadBytes({ MAX_UPLOAD_BYTES: "4096" })).toBe(4096);
    expect(maxUploadBytes({})).toBe(DEFAULT_MAX_UPLOAD_BYTES);
  });
});

describe("headerContentLength", () => {
  it("reads a well-formed header", () => {
    expect(headerContentLength("12345")).toBe(12345);
    expect(headerContentLength("0")).toBe(0);
  });

  /**
   * Null means "unknown", not "zero". A chunked request sends no Content-Length, and
   * collapsing that to 0 would wave an unbounded body straight past the early check.
   */
  it("returns null — not zero — when the header is absent or unusable", () => {
    for (const bad of [null, undefined, "", "  ", "abc", "-1", "1.5", "12,345"]) {
      expect(headerContentLength(bad)).toBeNull();
    }
  });
});

describe("exceedsUploadLimit", () => {
  it("compares a known size against the limit", () => {
    expect(exceedsUploadLimit(101, 100)).toBe(true);
    expect(exceedsUploadLimit(100, 100)).toBe(false);
    expect(exceedsUploadLimit(99, 100)).toBe(false);
  });

  // The early Content-Length check is an optimisation, not the guarantee; the
  // file.size check behind it is what actually holds when the size is unknown.
  it("treats an unknown size as not exceeding, so the later check decides", () => {
    expect(exceedsUploadLimit(null, 100)).toBe(false);
  });
});

describe("assertWithinUploadLimit", () => {
  it("passes a size at or under the limit, and an unknown size", () => {
    expect(() => assertWithinUploadLimit(100, 100)).not.toThrow();
    expect(() => assertWithinUploadLimit(null, 100)).not.toThrow();
  });

  it("throws 422 ID_INVALID on field 'file', matching the missing-file pairing", () => {
    let thrown: unknown;
    try {
      assertWithinUploadLimit(DEFAULT_MAX_UPLOAD_BYTES + 1, DEFAULT_MAX_UPLOAD_BYTES);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AppError);
    const error = thrown as AppError;
    expect(error.status).toBe(422);
    expect(error.code).toBe("ID_INVALID");
    expect(error.field).toBe("file");
    // The caller must be told what the limit is, or they cannot act on the refusal.
    expect(error.message).toContain("10 MB");
  });
});

describe("formatBytes", () => {
  it("renders a limit a person can act on", () => {
    expect(formatBytes(DEFAULT_MAX_UPLOAD_BYTES)).toBe("10 MB");
    expect(formatBytes(2 * 1024 * 1024)).toBe("2 MB");
    expect(formatBytes(4096)).toBe("4 KB");
    expect(formatBytes(512)).toBe("512 bytes");
  });
});
