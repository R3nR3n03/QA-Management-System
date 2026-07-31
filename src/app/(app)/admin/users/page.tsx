import { QamsRole } from "@prisma/client";
import { notFound } from "next/navigation";
import { listUsers } from "@/domain/admin";
import { requireSession } from "@/ui/session";
import { roleLabel } from "@/ui/navigation";
import { AddPersonForm } from "./AddPersonForm";
import { RoleForm } from "./RoleForm";

export const dynamic = "force-dynamic";

/**
 * People and their single active role (`roles-workflows.md:5`). The QA Lead creates
 * accounts here (`roles-workflows.md:16` — user management is a lead capability) and
 * changes roles; both are audited. There is no self-service password change in v1.
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
        that person can do everywhere, and every change is audited.
      </p>

      <h2>Add a person</h2>
      <div className="card" style={{ marginBottom: "var(--sp-6)" }}>
        <AddPersonForm />
      </div>

      <h2>Everyone</h2>
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
