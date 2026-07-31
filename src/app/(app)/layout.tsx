import { redirect } from "next/navigation";
import { profile } from "@/domain/auth";
import { navGroupsFor, roleLabel } from "@/ui/navigation";
import { NavRail } from "@/ui/nav-rail";
import { requireSession } from "@/ui/session";
import { signOut } from "../login/actions";

/**
 * The authenticated shell. The rail is generated from the role/capability matrix
 * (`src/ui/navigation.ts`), so a screen a role cannot reach is absent rather than
 * present-and-rejecting — `docs/excel-source-map.md:11`, "application navigation
 * derives from authorized capabilities". The link list itself is a client component
 * (`NavRail`) so the current screen is marked; layout and identity stay server-side.
 *
 * This is presentation only. Every screen behind it still goes through the domain
 * services, which are the single enforcement point.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireSession();
  const me = await profile(auth.userId);
  if (!me) redirect("/login");

  const groups = navGroupsFor(me.role).map((section) => ({
    group: section.group as string,
    items: section.items.map((item) => ({ href: item.href, label: item.label }))
  }));

  return (
    <div className="shell">
      <nav aria-label="Main" className="rail">
        <div className="rail-brand">QAMS</div>

        <NavRail groups={groups} />

        <div className="rail-footer">
          <div>
            <div style={{ fontSize: 13, fontWeight: 620, color: "var(--ink)" }}>{me.displayName}</div>
            <div className="muted" style={{ marginBottom: "var(--sp-2)" }}>{roleLabel(me.role)}</div>
          </div>
          <form action={signOut}>
            <button className="btn btn-secondary" type="submit" style={{ fontSize: 13, padding: "5px 12px" }}>
              Sign out
            </button>
          </form>
        </div>
      </nav>

      <main className="shell-main">{children}</main>
    </div>
  );
}
