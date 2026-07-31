import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { AppError } from "./errors";
import { isRecordNotFound, versionConflict, withVersionCheck } from "./optimistic-lock";

/** A real Prisma error, not a stand-in — the check is `instanceof` plus the code. */
function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("boom", { code, clientVersion: "7.0.0" });
}

describe("isRecordNotFound", () => {
  it("recognises P2025", () => {
    expect(isRecordNotFound(prismaError("P2025"))).toBe(true);
  });

  /**
   * Narrow on purpose. P2002 is a duplicate business ID and P2003 a foreign-key failure;
   * translating either into VERSION_CONFLICT would report the wrong cause. Mapping those is
   * finding B2 and is deliberately not done here.
   */
  it("does not claim other Prisma errors", () => {
    for (const code of ["P2002", "P2003", "P2000", "P1001"]) {
      expect(isRecordNotFound(prismaError(code))).toBe(false);
    }
  });

  it("does not claim ordinary errors", () => {
    for (const value of [new Error("P2025"), "P2025", null, undefined, {}, { code: "P2025" }]) {
      expect(isRecordNotFound(value)).toBe(false);
    }
  });
});

describe("versionConflict", () => {
  // docs/business-rules-and-validation.md:5 and :15 — conflicting versions are 409.
  it("is the documented 409 VERSION_CONFLICT on the version field", () => {
    const error = versionConflict();
    expect(error).toBeInstanceOf(AppError);
    expect(error.status).toBe(409);
    expect(error.code).toBe("VERSION_CONFLICT");
    expect(error.field).toBe("version");
  });
});

describe("withVersionCheck", () => {
  it("returns the value when the write succeeds", async () => {
    await expect(withVersionCheck(async () => "written")).resolves.toBe("written");
  });

  /**
   * The whole point: the UPDATE carries the expected version in its WHERE, so a concurrent
   * writer who already incremented it leaves this one matching no row. Prisma raises P2025,
   * and the caller must see the documented conflict rather than a 500.
   */
  it("turns a matched-no-row write into 409 VERSION_CONFLICT", async () => {
    let thrown: unknown;
    try {
      await withVersionCheck(async () => {
        throw prismaError("P2025");
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).status).toBe(409);
    expect((thrown as AppError).code).toBe("VERSION_CONFLICT");
  });

  /**
   * Everything else passes through untouched. If this swallowed other failures it would
   * relabel real bugs — a duplicate ID or a broken connection reported as a version
   * conflict would send whoever debugs it in precisely the wrong direction.
   */
  it("lets every other error through unchanged", async () => {
    const duplicate = prismaError("P2002");
    await expect(withVersionCheck(async () => { throw duplicate; })).rejects.toBe(duplicate);

    const plain = new Error("connection lost");
    await expect(withVersionCheck(async () => { throw plain; })).rejects.toBe(plain);

    // An AppError raised inside the transaction — a business rule failing — must keep its
    // own status rather than being recast as a conflict.
    const forbidden = new AppError(422, "FORBIDDEN_TRANSITION", "Only Draft can be edited.");
    await expect(withVersionCheck(async () => { throw forbidden; })).rejects.toBe(forbidden);
  });
});
