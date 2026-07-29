import { headers } from "next/headers";
import { AppError } from "./errors";

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
