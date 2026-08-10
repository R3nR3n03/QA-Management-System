import Link from "next/link";
import { Component, FolderTree, ListChecks, Package, SearchX } from "lucide-react";
import type { CatalogueDetail, DetailChild } from "@/domain/catalogue";
import { Breadcrumbs } from "@/ui/breadcrumbs";
import { formatUtcMinute } from "@/ui/format";
import { ListEmpty } from "@/ui/list-empty";
import type { ListSearchParams } from "@/ui/list-params";
import { Pager } from "@/ui/pager";
import {
  EditFeatureButton,
  EditModuleButton,
  EditProductButton,
  EditRequirementButton
} from "./CatalogueEditForms";
import { CHILD_PAGE_PARAM, selectionHref, type SelectionKind } from "./selection";

/**
 * The right-hand panel: the selected record, what it is part of, and what is inside it.
 *
 * One component for all three levels rather than three near-copies, because
 * `CatalogueDetail` already gives them one shape (`src/domain/catalogue.ts`). A server
 * component — the only interactive parts are the edit modals, which are their own client
 * islands.
 */

const CHILD_NOUN = {
  module: { one: "module", many: "modules" },
  feature: { one: "feature", many: "features" },
  requirement: { one: "requirement", many: "requirements" }
} as const;

/** The child level, once it is known to exist. A requirement has none. */
type ChildKind = "module" | "feature" | "requirement";

/** Every child level is selectable, whether or not the tree draws it as a row. */
const CHILD_SELECTION: Record<ChildKind, SelectionKind> = {
  module: "module",
  feature: "feature",
  requirement: "requirement"
};

export function DetailPanel({
  detail,
  params,
  childPage,
  needle,
  totals,
  hasAnyProduct
}: {
  detail: CatalogueDetail | null;
  params: ListSearchParams | undefined;
  /** The page of whatever child list this record has. One key, one list on screen. */
  childPage: number;
  needle: string;
  totals: { products: number; modules: number; features: number; requirements: number };
  hasAnyProduct: boolean;
}) {
  if (detail === null) {
    return <Overview needle={needle} totals={totals} hasAnyProduct={hasAnyProduct} />;
  }

  return (
    <>
      <RecordHeader detail={detail} params={params} />
      {/* A requirement is a leaf: nothing hangs off it, so there is no child section
          rather than an empty one claiming something is missing. */}
      {detail.childKind === null ? null : (
        <ChildSection
          detail={detail}
          childKind={detail.childKind}
          params={params}
          childPage={childPage}
        />
      )}
    </>
  );
}

/* ---------- header ---------- */

function RecordHeader({
  detail,
  params
}: {
  detail: CatalogueDetail;
  params: ListSearchParams | undefined;
}) {
  const inherited = detail.kind !== "product";

  return (
    <div className="cat-detail-head">
      <Breadcrumbs
        trail={[
          { href: selectionHref(params, null), label: "Catalogue" },
          ...detail.trail.map((step) => ({
            href: selectionHref(params, { kind: step.kind, businessId: step.businessId }),
            label: `${step.businessId} ${step.name}`
          }))
        ]}
        here={detail.businessId}
      />

      <div className="page-head">
        <div className="page-head-text">
          <h2>{detail.title}</h2>
          <p className="muted">
            <span className="bid">{detail.businessId}</span>
          </p>
        </div>
        <EditFor detail={detail} />
      </div>

      <dl className="fact-grid">
        {/* versionTag and status live on Product alone. On a module or a feature they are
            the product's, and the label has to say so — there is no such thing as a
            module's status (CATALOGUE-EXPLORER-REDESIGN.md § 0.5). */}
        <Fact
          label={inherited ? "Product version" : "Version"}
          value={detail.product.versionTag}
        />
        <Fact
          label={inherited ? "Product status" : "Status"}
          value={<span className="state">{detail.product.status}</span>}
        />
        {detail.stats.modules !== null ? (
          <Fact label="Modules" value={detail.stats.modules} />
        ) : null}
        {detail.stats.features !== null ? (
          <Fact label="Features" value={detail.stats.features} />
        ) : null}
        {detail.stats.requirements !== null ? (
          <Fact label="Requirements" value={detail.stats.requirements} />
        ) : null}
        {/* The optimistic-lock counter, not a release number — named so nobody reads it
            as one beside the product version two cells to the left. */}
        <Fact label="Record version" value={detail.version} />
        <Fact label="Updated" value={formatUtcMinute(detail.updatedAt)} />
        {/* Stands in for an owner, which no catalogue model has. */}
        <Fact label="Updated by" value={detail.updatedByName ?? "—"} />
      </dl>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function EditFor({ detail }: { detail: CatalogueDetail }) {
  if (detail.kind === "product") {
    return (
      <EditProductButton
        id={detail.id}
        version={detail.version}
        businessId={detail.businessId}
        name={detail.title}
        versionTag={detail.product.versionTag}
        status={detail.product.status}
      />
    );
  }
  if (detail.kind === "module") {
    return (
      <EditModuleButton
        id={detail.id}
        version={detail.version}
        businessId={detail.businessId}
        name={detail.title}
      />
    );
  }
  if (detail.kind === "feature") {
    return (
      <EditFeatureButton
        id={detail.id}
        version={detail.version}
        businessId={detail.businessId}
        name={detail.title}
      />
    );
  }
  return (
    <EditRequirementButton
      id={detail.id}
      version={detail.version}
      businessId={detail.businessId}
      statement={detail.title}
    />
  );
}

/* ---------- children ---------- */

/**
 * The selected record's children.
 *
 * All three levels are paged, and by ONE key. It used to be requirements alone, because
 * they were the only level with the cardinality to need it; a product with 300 modules
 * has the same problem and used to render all 300. The tree caps a branch at
 * `DEFAULT_CHILD_LIMIT` rows and points the overflow here, so here has to be the place
 * that can actually hold a long list — paged, timestamped, and editable in place.
 */
function ChildSection({
  detail,
  childKind,
  params,
  childPage
}: {
  detail: CatalogueDetail;
  childKind: ChildKind;
  params: ListSearchParams | undefined;
  childPage: number;
}) {
  const noun = CHILD_NOUN[childKind];

  return (
    <section aria-label={`${noun.many} of ${detail.businessId}`}>
      <div className="page-head cat-child-head">
        <h3>
          {noun.many.replace(/^./, (c) => c.toUpperCase())}{" "}
          <span className="cat-child-count">{detail.childTotal}</span>
        </h3>
      </div>

      <div className="card card-flush">
        {detail.children.length === 0 ? (
          // An empty page can mean two unrelated things — this record has no children, or
          // you are past the end of a list that shrank — and saying the wrong one is worse
          // than saying nothing. See src/ui/list-empty.tsx.
          <ListEmpty
            total={detail.childTotal}
            pathname="/catalogue"
            params={params}
            pageKey={CHILD_PAGE_PARAM}
            noMatch={<EmptyChild detail={detail} childKind={childKind} />}
          />
        ) : (
          <ul className="row-list">
            {detail.children.map((child) => (
              <ChildRow key={child.id} child={child} childKind={childKind} params={params} />
            ))}
          </ul>
        )}
      </div>

      {detail.children.length > 0 ? (
        <Pager
          total={detail.childTotal}
          page={childPage}
          pathname="/catalogue"
          params={params}
          pageKey={CHILD_PAGE_PARAM}
          label={noun.many}
        />
      ) : null}
    </section>
  );
}

function ChildRow({
  child,
  childKind,
  params
}: {
  child: DetailChild;
  childKind: ChildKind;
  params: ListSearchParams | undefined;
}) {
  const kind = CHILD_SELECTION[childKind];
  const grandchildNoun = childKind === "module" ? "feature" : "requirement";

  return (
    <li className="cat-child">
      <span className="bid">{child.businessId}</span>

      {/* Every child row selects. A requirement is the only level with no row in the tree,
          which makes this link the way to reach one — its statement is a sentence, and the
          panel is where a sentence is readable. */}
      <span className="cat-child-label">
        <Link
          className="row-link"
          href={selectionHref(params, { kind, businessId: child.businessId })}
        >
          {child.label}
        </Link>
      </span>

      {child.count === null ? (
        <span />
      ) : (
        <span className="cat-count" data-zero={child.count === 0 ? "" : undefined}>
          <span className="sr-only">
            {child.count} {grandchildNoun}
            {child.count === 1 ? "" : "s"}
          </span>
          <span aria-hidden>{child.count}</span>
        </span>
      )}

      <time className="muted cat-child-time" dateTime={child.updatedAt.toISOString()}>
        {formatUtcMinute(child.updatedAt)}
      </time>

      <EditChild child={child} childKind={childKind} />
    </li>
  );
}

function EditChild({ child, childKind }: { child: DetailChild; childKind: ChildKind }) {
  if (childKind === "module") {
    return (
      <EditModuleButton
        compact
        id={child.id}
        version={child.version}
        businessId={child.businessId}
        name={child.label}
      />
    );
  }
  if (childKind === "feature") {
    return (
      <EditFeatureButton
        compact
        id={child.id}
        version={child.version}
        businessId={child.businessId}
        name={child.label}
      />
    );
  }
  return (
    <EditRequirementButton
      compact
      id={child.id}
      version={child.version}
      businessId={child.businessId}
      statement={child.label}
    />
  );
}

/* ---------- empty states ---------- */

/**
 * Each names the situation, explains what the missing level is FOR, and leaves the action
 * to the header's contextual button — which already offers exactly this, so repeating it
 * here would put two primary buttons on screen competing for the same click.
 */
function EmptyChild({ detail, childKind }: { detail: CatalogueDetail; childKind: ChildKind }) {
  if (childKind === "module") {
    return (
      <Rich
        icon={<Package size={40} aria-hidden />}
        title={`${detail.businessId} has no modules yet.`}
        body="A module groups the features of one product. Add the first one from the button above."
      />
    );
  }
  if (childKind === "feature") {
    return (
      <Rich
        icon={<Component size={40} aria-hidden />}
        title={`${detail.businessId} has no features yet.`}
        body="Features are what test cases are written against. Add the first one from the button above."
      />
    );
  }
  return (
    <Rich
      icon={<ListChecks size={40} aria-hidden />}
      title={`${detail.businessId} has no requirements yet.`}
      body="Requirements are what the traceability matrix measures coverage against. Add the first one from the button above."
    />
  );
}

function Overview({
  needle,
  totals,
  hasAnyProduct
}: {
  needle: string;
  totals: { products: number; modules: number; features: number; requirements: number };
  hasAnyProduct: boolean;
}) {
  if (!hasAnyProduct) {
    return (
      <div className="card">
        <Rich
          icon={<FolderTree size={40} aria-hidden />}
          title="The catalogue is empty."
          body="Products are the top of the hierarchy — every module, feature and requirement hangs off one. Start with the button above."
        />
      </div>
    );
  }

  if (needle !== "") {
    return (
      <div className="card">
        <Rich
          icon={<SearchX size={40} aria-hidden />}
          title={`Showing matches for “${needle}”.`}
          body="Pick a result on the left to read it. Search ranks business IDs, names and requirement statements across all four levels — an exact ID first."
        />
      </div>
    );
  }

  return (
    <div className="card">
      <Rich
        icon={<FolderTree size={40} aria-hidden />}
        title="Pick something to see it."
        body={`Choose a product, module or feature on the left — or search to reach a requirement. ${totals.products} products · ${totals.modules} modules · ${totals.features} features · ${totals.requirements} requirements.`}
      />
    </div>
  );
}

function Rich({
  icon,
  title,
  body
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="empty-rich">
      {icon}
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}
