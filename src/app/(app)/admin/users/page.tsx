import { QamsRole } from "@prisma/client";
import { notFound } from "next/navigation";
import { listUsers } from "@/domain/admin";
import { readPage, readPageSize, type ListSearchParams } from "@/ui/list-params";
import { PAGE_SIZE, PAGE_SIZE_OPTIONS } from "@/ui/paging";
import { Pager } from "@/ui/pager";
import { requireSession } from "@/ui/session";
import { roleLabel } from "@/ui/navigation";
import { AddPersonModal } from "./AddPersonForm";
import { EditPersonForm } from "./EditPersonForm";
import { RoleForm } from "./RoleForm";

export const dynamic = "force-dynamic";

/**
 * People and their single active role (`roles-workflows.md:5`). The QA Lead creates
 * accounts here (`roles-workflows.md:16` — user management is a lead capability),
 * changes roles, edits profiles, and deactivates/reactivates accounts; all audited.
 * Deactivation is the only removal path — no user is ever deleted.
 */
export default async function UsersPage({
  searchParams
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  const params = await searchParams;
  const auth = await requireSession();
  // Lead-only screen: absent rather than present-and-rejecting for other roles
  // (the domain services behind it refuse them regardless).
  if (auth.role !== QamsRole.QA_LEAD) notFound();
  const page = readPage(params);
  const pageSize = readPageSize(params, PAGE_SIZE_OPTIONS, PAGE_SIZE);
  const { rows: users, total } = await listUsers(auth.role, { page, pageSize });

  return (
    <>
      <div className="page-head">
        <h1>People</h1>
        <AddPersonModal />
      </div>
      <p className="muted" style={{ marginBottom: "var(--sp-4)" }}>
        Every permission is enforced server-side from the session; changing a role here changes what
        that person can do everywhere, and every change is audited.
      </p>

      <div className="card card-flush">
        {/* Rows stay server-rendered (they carry server-action forms) and are the page
            the database returned, not the whole staff list sliced in the browser. */}
        <ul className="row-list">
          {users.map((user) => (
            <li key={user.id} className="list-row">
              <div className="row-main">
                <div className="row-title">
                  {user.displayName}
                  {user.id === auth.userId ? <span className="muted"> (you)</span> : null}
                </div>
                <div className="muted">
                  {user.email} · {roleLabel(user.role)}
                  {user.active ? "" : " · inactive"}
                </div>
              </div>
              <RoleForm
                userId={user.id}
                version={user.version}
                role={user.role}
                displayName={user.displayName}
                isSelf={user.id === auth.userId}
              />
              <EditPersonForm
                userId={user.id}
                version={user.version}
                displayName={user.displayName}
                email={user.email}
                active={user.active}
                isSelf={user.id === auth.userId}
              />
            </li>
          ))}
        </ul>
        <Pager total={total} page={page} pathname="/admin/users" params={params} pageSize={pageSize}
              sizeOptions={PAGE_SIZE_OPTIONS}
              label="people" />
      </div>
    </>
  );
}
