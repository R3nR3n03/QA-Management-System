import type { FormState } from "./action";

/**
 * The one way a screen shows a rejected submit: the translated error copy, with the
 * advisory tone reserved for POLICY_NOT_DEFINED (`business-rules-and-validation.md:38`)
 * and the request reference shown only for INTERNAL_ERROR, where it ties the report
 * to a log line. No hooks, so it renders from server and client components alike.
 */
export function FormNotice({ state }: { state: FormState }) {
  if (!state) return null;
  const calm = state.advisory || state.success;
  return (
    <div className={calm ? "notice notice-advisory" : "notice"} role={state.success ? "status" : "alert"}>
      <strong>{state.title}</strong>
      <span>{state.detail}</span>
      {state.requestId ? <code>Reference {state.requestId}</code> : null}
    </div>
  );
}
