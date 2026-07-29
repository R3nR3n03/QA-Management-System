import { AppError } from "./errors";

export function requireNonBlank(value: string | null | undefined, field: string, message: string) {
  if (!value || !value.trim()) {
    throw new AppError(422, "ID_INVALID", message, field);
  }
}

export function requireNonBlankIfProvided(value: string | undefined, field: string, message: string) {
  if (value !== undefined) requireNonBlank(value, field, message);
}

export function ensureVersion(actual: number, expected: number | undefined) {
  if (expected === undefined || actual !== expected) {
    throw new AppError(409, "VERSION_CONFLICT", "Record version conflict.", "version");
  }
}

export function ensureStepSequence(steps: Array<{ sequence: number }>) {
  const sorted = [...steps].sort((a, b) => a.sequence - b.sequence);
  for (let i = 0; i < sorted.length; i += 1) {
    if (sorted[i].sequence !== i + 1) {
      throw new AppError(422, "ID_INVALID", "Step sequence must be consecutive 1..n.", "steps");
    }
  }
}
