import type { FormState } from "./action";

/**
 * Field-level accessibility for the `bad()` idiom every form uses. The failure
 * message lives in the form's single FormNotice; these helpers associate the failed
 * control with it so assistive tech announces the error when the field is reached,
 * not only once at submit.
 *
 * Presentation only: which field failed still comes from `FormState.field`, set by
 * the domain's rejection — nothing here validates.
 */

/** A stable id for the form's FormNotice, so failed fields can point at it. */
export function noticeId(formId: string): string {
  return `${formId}-notice`;
}

/** Class for the `<label className="field">` wrapper of a possibly-failed field. */
export function fieldClass(state: FormState, field: string): string {
  return state?.field === field ? "field field-bad" : "field";
}

/** Spread onto the failed field's input/select/textarea itself. */
export function fieldProps(
  state: FormState,
  field: string,
  formId: string
): { "aria-invalid": true; "aria-describedby": string } | Record<string, never> {
  if (state?.field !== field) return {};
  return { "aria-invalid": true, "aria-describedby": noticeId(formId) };
}
