import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { mapPrismaError, uniqueViolationField } from "./prisma-errors";

function prismaError(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError(
    // Prisma's real messages embed the failing invocation and its data. This stands in for
    // that, and the tests below assert it never reaches the caller.
    'Invalid `prisma.product.create()` invocation: Unique constraint failed on businessId "PROD001"',
    { code, clientVersion: "7.0.0", meta }
  );
}

describe("uniqueViolationField", () => {
  it("reads a column list", () => {
    expect(uniqueViolationField({ target: ["businessId"] })).toBe("businessId");
    expect(uniqueViolationField({ target: ["catalogue", "value"] })).toBe("catalogue, value");
  });

  /**
   * Some drivers report the index name (`User_email_key`) rather than columns. That is an
   * internal identifier, and api-and-security.md:33 bars those — a client is meant to map
   * `field` to a form input, and an index name is worse than nothing there.
   */
  it("suppresses a raw index name rather than surfacing it", () => {
    expect(uniqueViolationField({ target: "User_email_key" })).toBeUndefined();
  });

  it("returns undefined when there is nothing usable", () => {
    for (const meta of [undefined, null, {}, { target: [] }, { target: [1, 2] }, "nope"]) {
      expect(uniqueViolationField(meta)).toBeUndefined();
    }
  });
});

describe("mapPrismaError", () => {
  it("ignores anything that is not a known Prisma request error", () => {
    for (const value of [new Error("boom"), null, undefined, "P2002", {}, { code: "P2002" }]) {
      expect(mapPrismaError(value)).toBeNull();
    }
  });

  /**
   * The headline case. Services pre-check for duplicates, so reaching the constraint means
   * two callers raced between the check and the insert — which
   * business-rules-and-validation.md:5 documents as 409, not 500.
   */
  it("maps a unique violation to 409 ID_DUPLICATE with the field", () => {
    expect(mapPrismaError(prismaError("P2002", { target: ["businessId"] }))).toEqual({
      status: 409,
      code: "ID_DUPLICATE",
      message: "A record with that identifier already exists.",
      field: "businessId"
    });
  });

  // A REFERENCED record missing is 422 REFERENCE_NOT_FOUND, distinct from the record the
  // caller actually asked for, which is 404 below.
  it("maps a foreign-key violation to 422 REFERENCE_NOT_FOUND", () => {
    expect(mapPrismaError(prismaError("P2003"))).toMatchObject({
      status: 422,
      code: "REFERENCE_NOT_FOUND"
    });
  });

  /**
   * P2025 is 404, NOT VERSION_CONFLICT. Versioned writes are wrapped in `withVersionCheck`,
   * which converts their P2025 to 409 before it can reach here — so a P2025 arriving at this
   * point is a different failure, and labelling it a version conflict would misdirect
   * whoever debugs it. This test is what stops that shortcut being taken later.
   */
  it("maps a missing target record to 404, not to a version conflict", () => {
    const mapped = mapPrismaError(prismaError("P2025"));
    expect(mapped).toMatchObject({ status: 404, code: "REFERENCE_NOT_FOUND" });
    expect(mapped?.code).not.toBe("VERSION_CONFLICT");
  });

  /**
   * Prisma's message contains the failing query and the data being written.
   * api-and-security.md:33 forbids exposing SQL detail, so every mapped message is a fixed
   * string. The original still reaches the structured log.
   */
  it("never returns Prisma's own message", () => {
    for (const code of ["P2002", "P2003", "P2025"]) {
      const mapped = mapPrismaError(prismaError(code, { target: ["businessId"] }));
      expect(mapped?.message).not.toContain("prisma.");
      expect(mapped?.message).not.toContain("invocation");
      expect(mapped?.message).not.toContain("PROD001");
    }
  });

  /**
   * Narrow on purpose: a code nobody has reasoned about keeps its 500, which is the honest
   * answer. It is no longer invisible, because the structured logging from C1 records the
   * original error and its code.
   */
  it("leaves unmapped codes alone", () => {
    for (const code of ["P2000", "P2001", "P1001", "P2014"]) {
      expect(mapPrismaError(prismaError(code))).toBeNull();
    }
  });
});
