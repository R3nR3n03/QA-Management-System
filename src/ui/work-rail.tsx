import Link from "next/link";
import {
  BarChart3,
  ChevronRight,
  CircleCheck,
  CirclePlay,
  ClipboardList,
  FilePen,
  ListChecks,
  Plus,
  Stamp,
  type LucideIcon
} from "lucide-react";
import { ExecutionLifecycleState } from "@prisma/client";
import { hrefWith, type ListSearchParams } from "./list-params";
import { WorkTipCard } from "./work-tip";
import type { WorkTip } from "./work-tips";

/**
 * The My work side rail: how much work there is, and the places a person goes next.
 *
 * Presentation only, like `work-queue.tsx` beside it. Every number is handed in, already
 * scoped to the viewer by the server, and every action is a plain link to a screen that
 * does its own gating — the rail grants nothing.
 *
 * ## Why there is no pass rate here
 *
 * `docs/business-rules-and-validation.md:39`: "No percentage, readiness threshold, or defect
 * ageing target is defined by this knowledge base. Return `POLICY_NOT_DEFINED` rather than
 * calculate or recommend one." A pass-rate tile is exactly that calculation, and a big green
 * "100%" also grades the number against an undefined threshold, which `:38` forbids
 * separately. The fourth tile counts the CASES inside the open runs instead — the one figure
 * the tabs cannot give, since three runs can be three cases or thirty-three.
 *
 * ## Why these are tiles and not a chart
 *
 * Four headline numbers with nothing to compare them against is a KPI row, not a plot (see
 * the dataviz form heuristic: a one-bar bar chart is the anti-pattern). Each tile carries an
 * icon and a word as well as its tone, so it never leans on colour alone, and the tones are
 * the SAME ones the rows below use — accent for In Progress, pass for Finalized — so a tile
 * and the rows it counts cannot look like different things.
 */

export type WorkRailCounts = {
  planned: number;
  inProgress: number;
  finalized: number;
  /** Covered cases across the unfinished runs — the size of the queue in real work. */
  openCases: number;
};

/** A rail action: a screen this viewer may actually reach. */
export type RailAction = {
  href: string;
  label: string;
  /** Which icon to draw. A key rather than a component so the page stays free of lucide. */
  icon: "new-run" | "drafts" | "review" | "dashboard";
};

const ACTION_ICON: Record<RailAction["icon"], LucideIcon> = {
  "new-run": Plus,
  drafts: FilePen,
  review: Stamp,
  dashboard: BarChart3
};

/**
 * One tile.
 *
 * The value uses the font's proportional figures deliberately — `tabular-nums` is for
 * columns that must align vertically, and at display size it makes a number like 121 read
 * loose. The tally in the queue's bar keeps tabular, because that one does jitter.
 */
function StatTile({
  label,
  value,
  tone,
  icon: Icon,
  href
}: {
  label: string;
  value: number;
  tone?: "progress" | "done";
  icon: LucideIcon;
  href: string;
}) {
  return (
    <Link className="stat-tile" href={href} data-tone={tone}>
      <span className="stat-tile-value">{value}</span>
      <span className="stat-tile-label">
        <Icon size={13} aria-hidden />
        {label}
      </span>
    </Link>
  );
}

export function WorkRail({
  counts,
  actions,
  tip,
  pathname = "/my-work",
  params,
  stateKey = "state",
  pageKey = "page"
}: {
  counts: WorkRailCounts;
  /** Already filtered to what this role may reach — see `navigation.ts`. */
  actions: RailAction[];
  /** Chosen on the server from the viewer's own queue. Omit to leave the card off. */
  tip?: WorkTip | null;
  pathname?: string;
  params: ListSearchParams | undefined;
  stateKey?: string;
  pageKey?: string;
}) {
  /* The tiles are links to the slice they count, which is what keeps them from being the
     tab tallies printed a second time: a tile is a way IN to its rows. They carry the rest
     of the query string, so a tile clicked under a product filter narrows rather than
     resets — and drop the page, because a shorter slice would land on nothing. */
  const slice = (state: ExecutionLifecycleState | null) =>
    hrefWith(pathname, params, { [stateKey]: state, [pageKey]: null });

  return (
    <aside className="work-rail" aria-label="Work overview and shortcuts">
      <section className="card work-rail-card">
        <h2 className="work-rail-head">Work overview</h2>
        <div className="stat-tiles">
          <StatTile
            label="Planned"
            value={counts.planned}
            icon={ClipboardList}
            href={slice(ExecutionLifecycleState.PLANNED)}
          />
          <StatTile
            label="In Progress"
            value={counts.inProgress}
            tone="progress"
            icon={CirclePlay}
            href={slice(ExecutionLifecycleState.IN_PROGRESS)}
          />
          <StatTile
            label="Finalized"
            value={counts.finalized}
            tone="done"
            icon={CircleCheck}
            /* The queue has no Finalized tab — finished runs are the recap below it, and
               everything older lives on the executions screen. */
            href="/executions?state=FINALIZED"
          />
          <StatTile
            label="Cases to run"
            value={counts.openCases}
            icon={ListChecks}
            href={slice(null)}
          />
        </div>
        {/* Counts, and nothing derived from them. The docs define no percentage or target
            (`business-rules-and-validation.md:39`), so there is nothing here to grade. */}
        <p className="muted work-rail-note">
          Your runs only, under the filters above. Cases to run counts every case the
          unfinished runs cover.
        </p>
      </section>

      {actions.length > 0 ? (
        <nav className="card work-rail-card" aria-label="Quick actions">
          <h2 className="work-rail-head">Quick actions</h2>
          <ul className="rail-actions">
            {actions.map((action) => {
              const Icon = ACTION_ICON[action.icon];
              return (
                <li key={action.href}>
                  <Link className="rail-action" href={action.href}>
                    <Icon size={16} aria-hidden />
                    <span>{action.label}</span>
                    <ChevronRight size={14} aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}

      {/* Last in the rail: it is the only panel here that is not about the viewer's own
          work, so it sits below the two that are. */}
      {tip ? <WorkTipCard tip={tip} /> : null}
    </aside>
  );
}
