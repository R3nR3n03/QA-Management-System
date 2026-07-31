import { mapPrismaError } from "./prisma-errors";

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

  // A database constraint that fired instead of a service check. architecture.md:46 designs
  // the database as the second line of defence; before this, every one of those became a
  // 500 and the reason was discarded (B2). The message is a fixed string, never Prisma's,
  // which embeds the failing query and its data.
  const mapped = mapPrismaError(err);
  if (mapped) {
    return Response.json(
      {
        error: {
          code: mapped.code,
          message: mapped.message,
          field: mapped.field,
          requestId
        }
      },
      { status: mapped.status }
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
