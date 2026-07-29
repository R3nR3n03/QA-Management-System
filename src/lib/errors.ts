export type ErrorCode =
  | "ID_INVALID"
  | "ID_DUPLICATE"
  | "REFERENCE_NOT_FOUND"
  | "REFERENCE_INACTIVE"
  | "HIERARCHY_MISMATCH"
  | "CONTROLLED_VALUE_INVALID"
  | "VERSION_CONFLICT"
  | "ROW_INCOMPLETE"
  | "RECONCILIATION_REQUIRED"
  | "POLICY_NOT_DEFINED"
  | "FORBIDDEN_TRANSITION"
  | "UNAUTHORIZED"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  public readonly status: number;
  public readonly code: ErrorCode;
  public readonly field?: string;

  constructor(status: number, code: ErrorCode, message: string, field?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

export function asErrorResponse(err: unknown, requestId: string): Response {
  if (err instanceof AppError) {
    return Response.json(
      {
        error: {
          code: err.code,
          message: err.message,
          field: err.field,
          requestId
        }
      },
      { status: err.status }
    );
  }

  return Response.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Unexpected error.",
        requestId
      }
    },
    { status: 500 }
  );
}
