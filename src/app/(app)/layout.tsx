import Link from "next/link";
import { redirect } from "next/navigation";
import { profile } from "@/domain/auth";
import { navGroupsFor, roleLabel } from "@/ui/navigation";
import { requireSession } from "@/ui/session";
import { signOut } from "../login/actions";

/**
 * The authenticated shell. The rail is generated from the role/capability matrix
 * (`src/ui/navigation.ts`), so a screen a role cannot reach is absent rather than
 * present-and-rejecting — `docs/excel-source-map.md:11`, "application navigation
 * derives from authorized capabilities".
 *
 * This is presentation only. Every screen behind it still goes through the domain
 * services, which are the single enforcement point.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireSession();
  const me = await profile(auth.userId);
  if (!me) redirect("/login");

  const groups = navGroupsFor(me.role);

  return (
    <div style={{ display: "flex", minHeight: "100vh", alignItems: "stretch" }}>
      <nav
        aria-label="Main"
        style={{
          width: 216,
          flex: "0 0 216px",
          background: "var(--surface-2)",
          borderRight: "1px solid var(--line)",
          padding: "var(--sp-5) 0",
          display: "flex",
          flexDirection: "column"
        }}
      >
        <div style={{ padding: "0 var(--sp-4) var(--sp-5)" }}>
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              letterSpacing: "0.14em",
              color: "var(--ink-3)"
            }}
          >
            QAMS
          </span>
        </div>

        {groups.map((section) => (
          <div key={section.group} style={{ marginBottom: "var(--sp-4)" }}>
            <div
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--ink-3)",
                padding: "0 var(--sp-4) var(--sp-1)"
              }}
            >
              {section.group}
            </div>
            {section.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: "block",
                  padding: "6px var(--sp-4)",
                  fontSize: 14,
                  fontWeight: 550,
                  color: "var(--ink-2)",
                  textDecoration: "none"
                }}
              >
                {item.label}
              </Link>
            ))}
          </div>
        ))}

        <div
          style={{
            marginTop: "auto",
            padding: "var(--sp-4)",
            borderTop: "1px solid var(--line)"
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 620, color: "var(--ink)" }}>{me.displayName}</div>
          <div className="muted" style={{ marginBottom: "var(--sp-2)" }}>{roleLabel(me.role)}</div>
          <form action={signOut}>
            <button className="btn btn-secondary" type="submit" style={{ fontSize: 13, padding: "5px 12px" }}>
              Sign out
            </button>
          </form>
        </div>
      </nav>

      <main style={{ flex: 1, minWidth: 0, padding: "var(--sp-6)", maxWidth: 1040 }}>{children}</main>
    </div>
  );
}
