import { headers } from "next/headers";
import type { z } from "zod";
import { AppError } from "./errors";
import { schemaValidationError } from "./request-schemas";

export async function requestMetadata() {
  const h = await headers();
  const requestId = h.get("x-request-id") ?? crypto.randomUUID();
  return { requestId };
}

export async function parseJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new AppError(422, "ID_INVALID", "Invalid JSON body.");
  }
}

/**
 * Parses and validates a request body against a schema.
 *
 * Unlike `parseJson`, which casts an unvalidated body to a caller-supplied type, this
 * returns a value that has actually been checked, so the body can never carry keys the
 * route did not declare. Malformed JSON and schema failures both surface as 422/ID_INVALID.
 */
export async function parseWith<T extends z.ZodType>(schema: T, request: Request): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AppError(422, "ID_INVALID", "Invalid JSON body.");
  }

  const result = schema.safeParse(raw);
  if (!result.success) throw schemaValidationError(result.error);
  return result.data;
}
