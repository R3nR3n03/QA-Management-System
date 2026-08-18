import { AppError } from "./errors";

/**
 * Size limiting for the workbook upload.
 *
 * `POST /imports/workbook` read the entire uploaded file into memory with no check
 * at all (`PRODUCTION-READINESS-2026-07-31.md` A2). One large upload could exhaust
 * the Node heap, and combined with a parser that has a published ReDoS advisory it
 * could hold a worker indefinitely.
 *
 * THE LIMIT IS NOT POLICY. `docs/api-and-security.md:43` places the exact limits for
 * this endpoint outside the knowledge base — "Exact limits are deployment policy and
 * are not defined here." The default below is therefore a deployment default, not a
 * documented rule, and is deliberately overridable. It wants QA Lead confirmation
 * before anything is deployed; 10 MB is simply generous for a seed workbook of the
 * shape `docs/excel-source-map.md` describes.
 *
 * Everything except `assertWithinUploadLimit` is pure, so the parsing and the
 * comparison are testable without a request, a server, or an environment.
 */

/** 10 MB. A deployment default, not a documented policy value — see above. */
export const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Reads `MAX_UPLOAD_BYTES`. An absent, non-numeric, non-integer, zero or negative
 * value falls back to the default rather than throwing.
 *
 * Falling back is safe *because the default is the restrictive direction*: a typo
 * cannot widen the limit, only fail to narrow it. A fallback that opened the gate
 * would be the wrong call here.
 */
export function parseMaxUploadBytes(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_MAX_UPLOAD_BYTES;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_MAX_UPLOAD_BYTES;
  return parsed;
}

export function maxUploadBytes(env: Record<string, string | undefined> = process.env): number {
  return parseMaxUploadBytes(env.MAX_UPLOAD_BYTES);
}

/**
 * A `Content-Length` header as a byte count, or null when it is absent or unusable.
 *
 * Null means "unknown", never "zero" — a chunked request sends no `Content-Length`,
 * and treating that as 0 would wave it straight through.
 */
export function headerContentLength(header: string | null | undefined): number | null {
  if (header === null || header === undefined || header.trim() === "") return null;
  const parsed = Number(header);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

/** An unknown size (null) never exceeds the limit; only a known, larger one does. */
export function exceedsUploadLimit(bytes: number | null, max: number): boolean {
  return bytes !== null && bytes > max;
}

/** Byte count for an error message. Not exact — it is prose, not a measurement. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

/**
 * Throws `422 ID_INVALID` on `file` when a known size exceeds the limit, matching the
 * pairing the missing-file case already uses: an oversized body is a malformed
 * request, not a missing referenced record.
 */
export function assertWithinUploadLimit(bytes: number | null, max: number, noun = "file"): void {
  if (exceedsUploadLimit(bytes, max)) {
    throw new AppError(
      422,
      "ID_INVALID",
      `The ${noun} is larger than the ${formatBytes(max)} limit for this endpoint.`,
      "file"
    );
  }
}
