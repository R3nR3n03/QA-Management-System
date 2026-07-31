import { headers } from "next/headers";

/**
 * Reads the per-request correlation id from the incoming headers.
 *
 * Kept out of `request.ts` deliberately: this is the only thing in the request layer that
 * touches `next/headers`, and that import made body parsing / validation impossible to unit
 * test. Everything in `request.ts` is now framework-free.
 */
export async function requestMetadata() {
  const h = await headers();
  const requestId = h.get("x-request-id") ?? crypto.randomUUID();
  return { requestId };
}
