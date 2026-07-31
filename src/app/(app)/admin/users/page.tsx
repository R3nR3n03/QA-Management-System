import { QamsRole } from "@prisma/client";
import { notFound } from "next/navigation";
import { listUsers } from "@/domain/admin";
import { requireSession } from "@/ui/session";
import { roleLabel } from "@/ui/navigation";
import { RoleForm } from "./RoleForm";

export const dynamic = "force-dynamic";

/**
 * People and their single active role (`roles-workflows.md:5`). Accounts are not
 * created here in v1 — they come from the seed or operational bootstrap; this screen
 * manages the role, which is the only mutation the docs establish.
 */
export default async function UsersPage() {
  const auth = await requireSession();
  // Lead-only screen: absent rather than present-and-rejecting for other roles
  // (the domain services behind it refuse them regardless).
  if (auth.role !== QamsRole.QA_LEAD) notFound();
  const users = await listUsers(auth.role);

  return (
    <>
      <h1>People</h1>
      <p className="muted" style={{ marginBottom: "var(--sp-4)" }}>
        Every permission is enforced server-side from the session; changing a role here changes what
        that person can do everywhere, and the change is audited.
      </p>

      <div className="card" style={{ padding: 0 }}>
        {users.map((user) => (
          <div
            key={user.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--sp-4)",
              padding: "var(--sp-3) var(--sp-5)",
              borderBottom: "1px solid var(--line-soft)",
              flexWrap: "wrap"
            }}
          >
            <div style={{ flex: "1 1 240px", minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: "var(--ink)" }}>
                {user.displayName}
                {user.id === auth.userId ? <span className="muted"> (you)</span> : null}
              </div>
              <div className="muted">
                {user.email} · {roleLabel(user.role)}
                {user.active ? "" : " · inactive"}
              </div>
            </div>
            <RoleForm userId={user.id} version={user.version} role={user.role} />
          </div>
        ))}
      </div>
    </>
  );
}
