import Link from "next/link";

/**
 * Breadcrumbs for detail screens: where am I, and one click back to the list. The
 * current record is text, not a link (`aria-current="page"` marks it), and the
 * separators are decorative — hidden from assistive tech, which reads the nav
 * label plus the ordered links.
 */
export function Breadcrumbs({
  trail,
  here
}: {
  trail: Array<{ href: string; label: string }>;
  here: string;
}) {
  return (
    <nav aria-label="Breadcrumb" className="crumbs">
      {trail.map((crumb) => (
        <span key={crumb.href} style={{ display: "contents" }}>
          <Link href={crumb.href}>{crumb.label}</Link>
          <span aria-hidden>/</span>
        </span>
      ))}
      <span className="crumb-here" aria-current="page">
        {here}
      </span>
    </nav>
  );
}
