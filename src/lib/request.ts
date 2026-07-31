import type { z } from "zod";
import { AppError } from "./errors";
import { schemaValidationError } from "./request-schemas/issues";

/**
 * Parses and validates a request body against a schema.
 *
 * This is the only way a route may read a JSON body. The former `parseJson<T>` cast has been
 * removed: it returned an unvalidated body under a caller-supplied type, so a `null`, scalar
 * or array body reached the domain layer and surfaced as a 500 on first dereference, and any
 * key the route did not declare travelled through untouched.
 *
 * Malformed JSON and schema failures both surface as 422/ID_INVALID, the pair already used by
 * `requireNonBlank` and `ensureStepSequence`.
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
