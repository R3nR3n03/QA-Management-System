import { redirect } from "next/navigation";
import { QamsRole } from "@prisma/client";
import { profile } from "@/domain/auth";
import { openAssignedExecutionCount } from "@/domain/executions";
import { reviewQueueCount } from "@/domain/test-cases";
import { navGroupsFor, roleLabel } from "@/ui/navigation";
import { Sidebar } from "@/ui/sidebar";
import { requireSession } from "@/ui/session";
import { signOut } from "../login/actions";

/**
 * The authenticated shell. The sidebar is generated from the role/capability matrix
 * (`src/ui/navigation.ts`), so a screen a role cannot reach is absent rather than
 * present-and-rejecting — `docs/excel-source-map.md:11`, "application navigation
 * derives from authorized capabilities". Identity, the item list, and the badge
 * counts are resolved server-side here; `Sidebar` handles presentation only.
 *
 * Badges are read models, not new capability: open runs assigned to the viewer on
 * "My work", and the review queue size on "Review" — which only reviewers have in
 * their nav to begin with, so the count follows the same gate as the screen.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireSession();
  const me = await profile(auth.userId);
  if (!me) redirect("/login");

  const groups = navGroupsFor(me.role).map((section) => ({
    group: section.group as string,
    items: section.items.map((item) => ({ href: item.href, label: item.label }))
  }));

  const isReviewer = me.role === QamsRole.SENIOR_QA_ENGINEER || me.role === QamsRole.QA_LEAD;
  const [myOpen, inReview] = await Promise.all([
    openAssignedExecutionCount(me.id),
    isReviewer ? reviewQueueCount() : Promise.resolve(0)
  ]);
  const badges: Record<string, number> = {};
  if (myOpen > 0) badges["/my-work"] = myOpen;
  if (inReview > 0) badges["/review"] = inReview;

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Sidebar
        groups={groups}
        badges={badges}
        user={{ displayName: me.displayName, roleLabel: roleLabel(me.role) }}
        signOutAction={signOut}
      />
      <main id="main" className="shell-main">
        {children}
      </main>
    </div>
  );
}
