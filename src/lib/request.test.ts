import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError } from "./errors";
import { parseWith } from "./request";

/**
 * `parseWith` is the single entry point every route now uses to read a JSON body.
 *
 * These tests only became possible once `requestMetadata` (the sole `next/headers` importer)
 * moved to `request-metadata.ts`: `request.ts` is now framework-free and loads under vitest.
 */

const schema = z.strictObject({
  name: z.string().min(1),
  count: z.number().optional()
});

function post(body: string) {
  return new Request("http://localhost/test", { method: "POST", body });
}

async function expectAppError(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error("Expected parseWith to throw.");
}

describe("parseWith", () => {
  it("returns the parsed value for a valid body", async () => {
    const result = await parseWith(schema, post(JSON.stringify({ name: "Alpha", count: 2 })));

    expect(result).toEqual({ name: "Alpha", count: 2 });
  });

  it("drops nothing and adds nothing to a valid body", async () => {
    const result = await parseWith(schema, post(JSON.stringify({ name: "Alpha" })));

    expect(Object.keys(result).sort()).toEqual(["name"]);
  });

  it("maps malformed JSON to 422 / ID_INVALID", async () => {
    const error = await expectAppError(parseWith(schema, post("{")));

    expect(error.status).toBe(422);
    expect(error.code).toBe("ID_INVALID");
    expect(error.message).toBe("Invalid JSON body.");
  });

  it("maps an empty body to 422 / ID_INVALID", async () => {
    const error = await expectAppError(parseWith(schema, post("")));

    expect(error.status).toBe(422);
    expect(error.code).toBe("ID_INVALID");
  });

  it("maps a null body to 422 rather than letting it reach the domain layer", async () => {
    // Audit §3.7: every route used to dereference the body immediately, so a literal `null`
    // surfaced as a TypeError and a 500.
    const error = await expectAppError(parseWith(schema, post("null")));

    expect(error.status).toBe(422);
    expect(error.code).toBe("ID_INVALID");
  });

  it("maps an array body to 422", async () => {
    const error = await expectAppError(parseWith(schema, post("[]")));

    expect(error.status).toBe(422);
    expect(error.code).toBe("ID_INVALID");
  });

  it("maps a scalar body to 422", async () => {
    const error = await expectAppError(parseWith(schema, post("3")));

    expect(error.status).toBe(422);
    expect(error.code).toBe("ID_INVALID");
  });

  it("reports the offending field for a schema failure", async () => {
    const error = await expectAppError(parseWith(schema, post(JSON.stringify({ count: 1 }))));

    expect(error.status).toBe(422);
    expect(error.field).toBe("name");
  });

  it("reports the smuggled key for an unrecognized field", async () => {
    const error = await expectAppError(
      parseWith(schema, post(JSON.stringify({ name: "Alpha", role: "QA_LEAD" })))
    );

    expect(error.status).toBe(422);
    expect(error.code).toBe("ID_INVALID");
    expect(error.field).toBe("role");
  });
});
