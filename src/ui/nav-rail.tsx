"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The navigation links, client-side only so the current screen can be marked.
 * Active is the LONGEST matching item for the pathname — so on /my-work/drafts,
 * "My drafts" lights up and "My work" does not, and detail pages such as
 * /test-cases/<id> keep their section lit. `aria-current` carries the state for
 * assistive tech; the visual treatment lives in globals.css (.nav-link).
 */
export type NavGroup = {
  group: string;
  items: Array<{ href: string; label: string }>;
};

function matches(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavRail({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const activeHref = groups
    .flatMap((section) => section.items)
    .filter((item) => matches(pathname, item.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <div className="rail-groups">
      {groups.map((section) => (
        <div key={section.group} className="rail-group">
          <div className="rail-heading">{section.group}</div>
          {section.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="nav-link"
              aria-current={item.href === activeHref ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </div>
      ))}
    </div>
  );
}
