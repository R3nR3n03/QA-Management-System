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
import { selectionHref, type SelectionKind } from "./selection";

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

/** The child level is selectable in the tree, except for requirements. */
const CHILD_SELECTION: Record<string, SelectionKind | null> = {
  module: "module",
  feature: "feature",
  requirement: null
};

export function DetailPanel({
  detail,
  params,
  requirementPage,
  needle,
  totals,
  hasAnyProduct
}: {
  detail: CatalogueDetail | null;
  params: ListSearchParams | undefined;
  requirementPage: number;
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
      <ChildSection
        detail={detail}
        params={params}
        requirementPage={requirementPage}
      />
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
        <Fact label="Requirements" value={detail.stats.requirements} />
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
  return (
    <EditFeatureButton
      id={detail.id}
      version={detail.version}
      businessId={detail.businessId}
      name={detail.title}
    />
  );
}

/* ---------- children ---------- */

function ChildSection({
  detail,
  params,
  requirementPage
}: {
  detail: CatalogueDetail;
  params: ListSearchParams | undefined;
  requirementPage: number;
}) {
  const noun = CHILD_NOUN[detail.childKind];
  const paged = detail.childKind === "requirement";

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
          paged ? (
            // A requirement list can be empty for two unrelated reasons and saying the
            // wrong one is worse than saying nothing — see src/ui/list-empty.tsx.
            <ListEmpty
              total={detail.childTotal}
              pathname="/catalogue"
              params={params}
              pageKey="req"
              noMatch={<EmptyChild detail={detail} />}
            />
          ) : (
            <EmptyChild detail={detail} />
          )
        ) : (
          <ul className="row-list">
            {detail.children.map((child) => (
              <ChildRow
                key={child.id}
                child={child}
                childKind={detail.childKind}
                params={params}
              />
            ))}
          </ul>
        )}
      </div>

      {paged && detail.children.length > 0 ? (
        <Pager
          total={detail.childTotal}
          page={requirementPage}
          pathname="/catalogue"
          params={params}
          pageKey="req"
          label="requirements"
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
  childKind: CatalogueDetail["childKind"];
  params: ListSearchParams | undefined;
}) {
  const kind = CHILD_SELECTION[childKind];
  const grandchildNoun = childKind === "module" ? "feature" : "requirement";

  return (
    <li className="cat-child">
      <span className="bid">{child.businessId}</span>

      {/* A module or feature row drills down; a requirement is a leaf and has nowhere to
          go, so it is text rather than a link that would do nothing. */}
      <span className="cat-child-label">
        {kind ? (
          <Link className="row-link" href={selectionHref(params, { kind, businessId: child.businessId })}>
            {child.label}
          </Link>
        ) : (
          child.label
        )}
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

function EditChild({
  child,
  childKind
}: {
  child: DetailChild;
  childKind: CatalogueDetail["childKind"];
}) {
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
function EmptyChild({ detail }: { detail: CatalogueDetail }) {
  if (detail.childKind === "module") {
    return (
      <Rich
        icon={<Package size={40} aria-hidden />}
        title={`${detail.businessId} has no modules yet.`}
        body="A module groups the features of one product. Add the first one from the button above."
      />
    );
  }
  if (detail.childKind === "feature") {
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
          body="Pick one on the left to see it. Search looks at business IDs, names and requirement statements across all four levels."
        />
      </div>
    );
  }

  return (
    <div className="card">
      <Rich
        icon={<FolderTree size={40} aria-hidden />}
        title="Pick something to see it."
        body={`Choose a product, module or feature on the left. ${totals.products} products · ${totals.modules} modules · ${totals.features} features · ${totals.requirements} requirements.`}
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
