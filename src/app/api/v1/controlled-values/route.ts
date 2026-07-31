import { createControlledValue, listControlledValues, updateControlledValue } from "@/domain/admin";
import { parseWith } from "@/lib/request";
import { createControlledValueSchema, updateControlledValueSchema } from "@/lib/request-schemas/admin";
import { withRoute } from "@/lib/route";

export async function GET(request: Request) {
  return withRoute(request, async () => {
    const rows = await listControlledValues();
    return Response.json(rows);
  });
}

export async function POST(request: Request) {
  return withRoute(request, async ({ auth, requestId }) => {
    // The QA-Lead gate lives in createControlledValue, where api-and-security.md:38
    // requires it, rather than only here.
    const body = await parseWith(createControlledValueSchema, request);
    const created = await createControlledValue({
      catalogue: body.catalogue,
      value: body.value,
      actorId: auth.userId,
      actorRole: auth.role,
      requestId
    });
    return Response.json(created, { status: 201 });
  });
}

export async function PATCH(request: Request) {
  return withRoute(request, async ({ auth, requestId }) => {
    // The QA-Lead gate lives in updateControlledValue, where api-and-security.md:38
    // requires it, rather than only here.
    const body = await parseWith(updateControlledValueSchema, request);
    const updated = await updateControlledValue(body.id, {
      active: body.active,
      version: body.version,
      actorId: auth.userId,
      actorRole: auth.role,
      requestId
    });
    return Response.json(updated);
  });
}
