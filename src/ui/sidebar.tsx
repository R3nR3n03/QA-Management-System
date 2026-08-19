"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType
} from "react";
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
import { useStoredPref } from "./stored-pref";

/**
 * The application sidebar. Same items, same targets, same role-derived inventory as
 * before (`src/ui/navigation.ts` is still the single source of screens) — this file
 * only changes how the rail LOOKS and is operated:
 *
 *   - searchable (filter-as-you-type, Ctrl/Cmd+K reaches it, Escape clears)
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

export type SidebarUser = {
  displayName: string;
  roleLabel: string;
  /**
   * The zone every stamp on every screen is drawn in, stated ONCE here.
   *
   * Per-row labelling was the alternative and it is worse: the zone is constant for a
   * viewer, so repeating it down forty rows of a list is noise that trains people to stop
   * reading it. Here it sits beside the identity it belongs to, which is where somebody
   * unsure of it looks (ADR-0007).
   */
  timeZone: string;
};

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

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
}

function matches(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/*
 * Which modifier this reader's platform prints on a keyboard shortcut.
 *
 * `useSyncExternalStore` and not an effect that calls `setModKey`: the platform is an external
 * system read during render, the server snapshot below is what keeps hydration clean, and there
 * is no cascading setState — which is the whole reason `react-hooks/set-state-in-effect` exists.
 * `useStoredPref` is the same shape over `localStorage`, and it records why the read has to work
 * this way.
 *
 * Hoisted for the reason that file gives: an arrow in a component body is a new identity every
 * render, and this component re-renders on every keystroke in its own search box.
 *
 * The platform never changes mid-session, so `subscribe` attaches nothing and the store settles
 * after one read. `navigator.platform` is deprecated but is the only honest answer where it is
 * still populated; the userAgent covers the browsers that have dropped it.
 */
const subscribeToNothing = () => () => {};
const readModKey = () =>
  /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl";
/* Windows and Linux are the server's guess, and the client's first render agrees with it, so a
   reader on either sees no repaint. A Mac corrects itself once, after hydration. */
const serverModKey = () => "Ctrl";

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
  const searchRef = useRef<HTMLInputElement | null>(null);
  /* Set when the shortcut fires against a COLLAPSED rail: the box is not rendered there, so the
     focus has to wait for the expand to commit. A ref and not state — nothing renders from it. */
  const focusOnExpand = useRef(false);
  const modKey = useSyncExternalStore(subscribeToNothing, readModKey, serverModKey);

  // DOM side effect only — no state changes — so the stored choice takes effect on
  // mount and on every switch.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  /**
   * Ctrl/Cmd+K reaches the navigation search from anywhere on the page.
   *
   * Both modifiers are accepted rather than branching on the platform: the handler cannot be
   * wrong about which key this reader pressed, and neither browser binds the other one.
   *
   * It stands down while focus is in a field someone is typing in. Two reasons, and the second
   * is the real one: a nav shortcut must never eat a keystroke aimed at a form, and Ctrl+K is
   * macOS's own kill-line inside a text field, which this would otherwise silently break. WCAG
   * 2.2 SC 2.1.4 does not reach a shortcut that requires a modifier, so nothing here needs an
   * opt-out — but a shortcut that steals typing would still be wrong.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "k" && event.key !== "K") return;
      if (!event.metaKey && !event.ctrlKey) return;
      const target = event.target as HTMLElement | null;
      if (target && target !== searchRef.current) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return;
      }
      event.preventDefault();
      if (searchRef.current) {
        searchRef.current.focus();
        searchRef.current.select();
        return;
      }
      focusOnExpand.current = true;
      setCollapsedPref("0");
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [setCollapsedPref]);

  // The second half of the collapsed case: the box exists now, so it can take focus.
  useEffect(() => {
    if (collapsed || !focusOnExpand.current) return;
    focusOnExpand.current = false;
    searchRef.current?.focus();
  }, [collapsed]);

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
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
            placeholder="Find a screen…"
            aria-label="Search navigation"
            /* Both, because the handler accepts both. This is what makes the shortcut
               discoverable to a reader who never sees the printed `<kbd>`. */
            aria-keyshortcuts="Control+K Meta+K"
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
          ) : (
            /* Hidden once there is a needle, where the Clear button takes the slot — and where a
               shortcut that reaches a box already focused is not worth the width. `aria-hidden`
               because `aria-keyshortcuts` above already tells assistive tech the same thing, in
               the form it expects. */
            <kbd className="rail-kbd" aria-hidden>
              {modKey} K
            </kbd>
          )}
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
          {/* Titled rather than left bare: the name alone answers "which clock", and the
              title answers "why is this here" for somebody who has never wondered. */}
          <div className="rail-zone" title={`Times are shown in ${user.timeZone}`}>
            {user.timeZone}
          </div>
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
