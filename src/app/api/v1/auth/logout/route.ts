import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/lib/session";

export async function POST() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
  return new Response(null, { status: 204 });
}
