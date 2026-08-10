/**
 * Reading optional fields out of a `FormData`.
 *
 * Every server action here does `String(formData.get("x") ?? "")`, which is right for a
 * required field and wrong for an optional one: it collapses "the form did not include this
 * field" and "the user cleared this field" into the same empty string. For a field like
 * `jiraIssueKey` those mean opposite things — leave the stored value alone, versus remove it
 * — and `updateExecution` distinguishes them by `undefined` versus `null`.
 *
 * Shape only. Nothing here validates: a malformed value is passed through so the domain
 * service refuses it with the documented error code, which is the same division of labour
 * the request schemas keep (`src/lib/request-schemas/executions.ts`).
 */

/**
 * The value of an optional text field.
 *
 * - `undefined` — the field was not submitted at all. Leave whatever is stored alone.
 * - `null` — the field was submitted empty or blank. Clear the stored value.
 * - a string — trimmed, never empty.
 *
 * A non-text entry (a file input) reads as absent rather than being stringified into
 * `"[object File]"` and sent to a domain service as if a person had typed it.
 */
export function readOptionalText(formData: FormData, name: string): string | null | undefined {
  const raw = formData.get(name);
  if (raw === null) return undefined;
  if (typeof raw !== "string") return undefined;

  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}
