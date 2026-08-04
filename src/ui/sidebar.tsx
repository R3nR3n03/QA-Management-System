"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore, type ComponentType } from "react";
import {
  Bug,
  ChevronsLeft,
  ChevronsRight,
  ClipboardCheck,
  FileUp,
  FlaskConical,
  FolderTree,
  Gauge,
  ListChecks,
  LogOut,
  Monitor,
  Moon,
  Network,
  PenLine,
  PlayCircle,
  Rocket,
  Search,
  SlidersHorizontal,
  Sun,
  UserRound,
  Users,
  X
} from "lucide-react";

/**
 * The application sidebar. Same items, same targets, same role-derived inventory as
 * before (`src/ui/navigation.ts` is still the single source of screens) — this file
 * only changes how the rail LOOKS and is operated:
 *
 *   - searchable (filter-as-you-type, Escape clears)
 *   - collapsible to an icon rail on desktop, persisted per browser
 *   - active page indicated by aria-current, styled from it (never a class alone)
 *   - live badges: open assigned runs on "My work", cases awaiting review on "Review"
 *   - theme control (system / light / dark), persisted per browser
 *   - the user's identity and sign-out at the bottom, as before
 *
 * Collapse and theme are applied AFTER hydration on purpose: reading localStorage in
 * the first render would make the server and client render different HTML. The cost
 * is a one-frame expanded/system-theme flash for users who chose otherwise; for an
 * internal tool that is the right trade against hydration errors.
 */

export type SidebarGroup = {
  group: string;
  items: Array<{ href: string; label: string }>;
};

export type SidebarUser = { displayName: string; roleLabel: string };

const ICONS: Record<string, ComponentType<{ size?: number; strokeWidth?: number; "aria-hidden"?: boolean }>> = {
  "/my-work": ListChecks,
  "/my-work/drafts": PenLine,
  "/account": UserRound,
  "/review": ClipboardCheck,
  "/test-cases": FlaskConical,
  "/executions": PlayCircle,
  "/defects": Bug,
  "/traceability": Network,
  "/dashboard": Gauge,
  "/catalogue": FolderTree,
  "/admin/controlled-values": SlidersHorizontal,
  "/admin/users": Users,
  "/admin/imports": FileUp,
  "/release-readiness": Rocket
};

type Theme = "system" | "light" | "dark";
const THEME_KEY = "qams-theme";
const COLLAPSE_KEY = "qams-nav-collapsed";
const PREF_EVENT = "qams-pref-change";

/**
 * A localStorage-backed preference as React state, via useSyncExternalStore so the
 * server snapshot (the fallback) and the client snapshot resolve without a hydration
 * mismatch — users who chose a non-default see one repaint after hydration, never an
 * error. Writes notify through one window event so every subscriber re-reads.
 */
/**
 * Hoisted, not inline: `useSyncExternalStore` re-subscribes whenever the `subscribe`
 * identity changes, and an arrow defined in the body is a new function every render.
 * This component re-renders on every keystroke in the rail search and on every route
 * change, so an inline version tore down and re-attached four window listeners each
 * time. It closes over nothing, so there is no reason for it to live in the body.
 */
function subscribeToPrefs(onChange: () => void): () => void {
  window.addEventListener(PREF_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(PREF_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function useStoredPref(key: string, fallback: string): [string, (value: string | null) => void] {
  const value = useSyncExternalStore(
    subscribeToPrefs,
    // Storage can throw outright — Safari private browsing, or a browser configured to
    // block it. This runs during render, so an unguarded read would take the whole
    // client tree down over a preference. A preference is never worth that: fall back.
    () => {
      try {
        return localStorage.getItem(key) ?? fallback;
      } catch {
        return fallback;
      }
    },
    () => fallback
  );
  const set = (next: string | null) => {
    try {
      if (next === null) localStorage.removeItem(key);
      else localStorage.setItem(key, next);
    } catch {
      // Not persisted. The event below still repaints this session correctly.
    }
    window.dispatchEvent(new Event(PREF_EVENT));
  };
  return [value, set];
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
}

function matches(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({
  groups,
  badges,
  user,
  signOutAction
}: {
  groups: SidebarGroup[];
  badges: Record<string, number>;
  user: SidebarUser;
  signOutAction: () => Promise<void>;
}) {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [collapsedPref, setCollapsedPref] = useStoredPref(COLLAPSE_KEY, "0");
  const [themePref, setThemePref] = useStoredPref(THEME_KEY, "system");
  const collapsed = collapsedPref === "1";
  const theme: Theme = themePref === "light" || themePref === "dark" ? themePref : "system";

  // DOM side effect only — no state changes — so the stored choice takes effect on
  // mount and on every switch.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  /**
   * Collapsing clears the needle. The search box only renders while expanded, so a
   * filter left active kept narrowing a list whose control had just left the screen —
   * and a needle that matched nothing collapsed to a rail with no links at all (the
   * "No screens match." line is itself hidden when collapsed). On a phone that was
   * unrecoverable: the expand button is `display: none` under 760px, so the user was
   * left with no navigation and no way to bring it back.
   */
  const toggleCollapsed = () => {
    setQuery("");
    setCollapsedPref(collapsed ? "0" : "1");
  };

  const cycleTheme = () => {
    const order: Theme[] = ["system", "light", "dark"];
    const next = order[(order.indexOf(theme) + 1) % order.length];
    setThemePref(next === "system" ? null : next);
  };

  const activeHref = groups
    .flatMap((section) => section.items)
    .filter((item) => matches(pathname, item.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  const visibleGroups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return groups;
    return groups
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => item.label.toLowerCase().includes(needle))
      }))
      .filter((section) => section.items.length > 0);
  }, [groups, query]);

  const initials = user.displayName
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  const themeLabel = `Theme: ${theme}. Click to switch.`;

  return (
    <nav aria-label="Main" className={`rail${collapsed ? " rail-collapsed" : ""}`}>
      <div className="rail-top">
        {/* The mark is decoration and the word is the name, at BOTH widths: collapsed,
            `.rail-word` is clipped rather than removed, so the rail still announces
            "QAMS". This used to be `collapsed ? "Q" : "QAMS"`, which swapped the real
            text — a collapsed rail introduced itself as "Q". */}
        <span className="rail-brand">
          <span className="rail-mark" aria-hidden="true">
            Q
          </span>
          <span className="rail-word">QAMS</span>
        </span>
        <button
          type="button"
          className="rail-icon-btn rail-collapse-btn"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          title={collapsed ? "Expand navigation" : "Collapse navigation"}
        >
          {collapsed ? <ChevronsRight size={16} aria-hidden /> : <ChevronsLeft size={16} aria-hidden />}
        </button>
      </div>

      {!collapsed ? (
        <div className="rail-search">
          <Search size={14} aria-hidden className="rail-search-icon" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
            placeholder="Find a screen…"
            aria-label="Search navigation"
          />
          {query ? (
            <button
              type="button"
              className="rail-icon-btn"
              onClick={() => setQuery("")}
              aria-label="Clear search"
            >
              <X size={13} aria-hidden />
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="rail-groups">
        {visibleGroups.length === 0 ? (
          <p className="rail-empty">No screens match.</p>
        ) : (
          visibleGroups.map((section) => {
            /* Derived from the group name rather than `useId`, so it is stable across
               the server and client renders and readable in the DOM. `navigation.ts`
               fixes the three names, and they are unique by construction. */
            const headingId = `rail-group-${section.group.toLowerCase().replace(/\s+/g, "-")}`;
            return (
              /* The heading was previously a bare `<div>` — drawn, but invisible to
                 assistive tech, so the rail announced one flat run of links with no
                 boundary between "My work", "Records" and "Administration". Naming the
                 group from the text already on screen restores the structure a sighted
                 reader gets for free.

                 This survives collapse: `.rail-heading` is `display: none` there, but
                 accname explicitly USES a hidden element when `aria-labelledby` points
                 directly at it, so the groups stay named on the icon rail too. */
              <div
                key={section.group}
                className="rail-group"
                role="group"
                aria-labelledby={headingId}
              >
                <div className="rail-heading" id={headingId}>
                  {section.group}
                </div>
                {section.items.map((item) => {
                  const Icon = ICONS[item.href] ?? ListChecks;
                  const badge = badges[item.href];
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="nav-link"
                      aria-current={item.href === activeHref ? "page" : undefined}
                      title={collapsed ? item.label : undefined}
                      /* Collapsed, `.nav-label` is `display: none` — out of the
                         accessibility tree — while the badge is only clip-hidden and
                         stays in it. Name-from-content therefore produced "12 waiting"
                         with no screen name at all, so the items a reader most needs to
                         reach were the ones they could not identify. `title` does not
                         rescue it: that is consulted only when content yields nothing.
                         An explicit name sidesteps the whole computation. */
                      aria-label={
                        collapsed
                          ? badge
                            ? `${item.label}, ${badge} waiting`
                            : item.label
                          : undefined
                      }
                    >
                      <Icon size={17} strokeWidth={1.9} aria-hidden />
                      <span className="nav-label">{item.label}</span>
                      {badge ? (
                        /* Not `aria-label` on the span: ARIA prohibits naming a generic
                           role, so its exposure is unreliable. Real text, visually
                           replaced by the abbreviated count. */
                        <span className="nav-badge">
                          <span className="sr-only">{badge} waiting</span>
                          <span aria-hidden="true">{badge > 99 ? "99+" : badge}</span>
                        </span>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            );
          })
        )}
      </div>

      <div className="rail-footer">
        <div className="rail-avatar" aria-hidden>
          {initials}
        </div>
        <div className="rail-identity">
          <div className="rail-name">{user.displayName}</div>
          <div className="rail-role">{user.roleLabel}</div>
        </div>
        <button
          type="button"
          className="rail-icon-btn"
          onClick={cycleTheme}
          aria-label={themeLabel}
          title={themeLabel}
        >
          <ThemeIcon size={15} aria-hidden />
        </button>
        <form action={signOutAction}>
          <button className="rail-icon-btn" type="submit" aria-label="Sign out" title="Sign out">
            <LogOut size={15} aria-hidden />
          </button>
        </form>
      </div>
    </nav>
  );
}
