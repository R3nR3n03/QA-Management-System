import { QamsRole } from "@prisma/client";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import {
  catalogueTotals,
  createFeature,
  createModule,
  createProduct,
  createRequirement,
  getFeatureDetail,
  getModuleDetail,
  getProductDetail,
  getRequirementDetail,
  listCatalogueTree,
  searchCatalogue
} from "@/domain/catalogue";

/**
 * The catalogue explorer's READS, against a real database.
 *
 * Separate from `acceptance.test.ts` on purpose: that file is the automated form of the
 * scenarios in `docs/testing-and-acceptance.md` and reads as one sequential story. These
 * are not documented acceptance scenarios — they are the query half of
 * `listCatalogueTree` and the detail getters, whose SHAPE is already unit-tested in
 * `src/domain/catalogue-tree.test.ts` without a database. What is left to prove here is
 * the part only PostgreSQL can answer: that the lazy branch fetch, the `groupBy` counts
 * and the search predicate return what the pure layer was tested against.
 *
 * Truncates before it seeds, like every file under this config
 * (`vitest.acceptance.config.ts` — one worker, no file parallelism).
 */

const REQ = "catalogue-explorer-suite";
const LEAD_NAME = "Explorer Lead";

let lead: { userId: string; role: QamsRole; requestId: string };

async function truncateAll() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  const joined = tables.map((t) => `"${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${joined} RESTART IDENTITY CASCADE`);
}

/**
 * PROD001 Retail Banking
 *   MOD001 Onboarding        — no features, so the "open but empty" branch is covered
 *   MOD002 Checkout
 *     FEAT001 Card capture   — REQ001, REQ002
 *     FEAT002 3-D Secure     — REQ003
 * PROD002 Wealth
 *   MOD003 Portfolio
 *     FEAT003 Rebalancing    — no requirements
 */
beforeAll(async () => {
  await truncateAll();

  const user = await prisma.user.create({
    data: {
      email: "explorer-lead@example.test",
      displayName: LEAD_NAME,
      role: QamsRole.QA_LEAD,
      passwordHash: "not-a-real-hash",
      createdBy: "test",
      updatedBy: "test"
    }
  });
  lead = { userId: user.id, role: QamsRole.QA_LEAD, requestId: REQ };

  const retail = await createProduct(
    { businessId: "PROD001", name: "Retail Banking", versionTag: "2.1", status: "Active" },
    lead
  );
  const wealth = await createProduct(
    { businessId: "PROD002", name: "Wealth", versionTag: "0.9", status: "Inactive" },
    lead
  );

  await createModule({ businessId: "MOD001", name: "Onboarding", productId: retail.id }, lead);
  const checkout = await createModule(
    { businessId: "MOD002", name: "Checkout", productId: retail.id },
    lead
  );
  const portfolio = await createModule(
    { businessId: "MOD003", name: "Portfolio", productId: wealth.id },
    lead
  );

  const cardCapture = await createFeature(
    { businessId: "FEAT001", name: "Card capture", moduleId: checkout.id },
    lead
  );
  const threeDS = await createFeature(
    { businessId: "FEAT002", name: "3-D Secure", moduleId: checkout.id },
    lead
  );
  await createFeature({ businessId: "FEAT003", name: "Rebalancing", moduleId: portfolio.id }, lead);

  await createRequirement(
    { businessId: "REQ001", statement: "A card number is validated before capture", featureId: cardCapture.id },
    lead
  );
  await createRequirement(
    { businessId: "REQ002", statement: "An expired card is refused", featureId: cardCapture.id },
    lead
  );
  await createRequirement(
    { businessId: "REQ003", statement: "A challenge is issued for a flagged transaction", featureId: threeDS.id },
    lead
  );
});

const idOf = async (table: "product" | "module" | "feature" | "requirement", businessId: string) => {
  const row = await (prisma[table] as { findUniqueOrThrow: (a: unknown) => Promise<{ id: string }> })
    .findUniqueOrThrow({ where: { businessId }, select: { id: true } });
  return row.id;
};

describe("catalogueTotals", () => {
  it("counts all four levels", async () => {
    expect(await catalogueTotals()).toEqual({
      products: 2,
      modules: 3,
      features: 3,
      requirements: 3
    });
  });
});

describe("listCatalogueTree — browsing", () => {
  // The lazy fetch: with nothing open, the query cost is the product list plus one
  // grouped count, and no branch is drawn as loaded.
  it("returns every product with its module count and no loaded branches", async () => {
    const tree = await listCatalogueTree();
    expect(tree.products.map((p) => p.businessId)).toEqual(["PROD001", "PROD002"]);
    expect(tree.products.map((p) => p.moduleCount)).toEqual([2, 1]);
    expect(tree.products.map((p) => p.modules)).toEqual([null, null]);
    expect(tree.hiddenProducts).toBe(0);
  });

  it("loads only the open product's modules, with their feature counts", async () => {
    const tree = await listCatalogueTree({ openProductId: await idOf("product", "PROD001") });
    const [retail, wealth] = tree.products;

    expect(retail.modules?.map((m) => m.businessId)).toEqual(["MOD001", "MOD002"]);
    expect(retail.modules?.map((m) => m.featureCount)).toEqual([0, 2]);
    expect(retail.modules?.every((m) => m.features === null)).toBe(true);
    expect(wealth.modules).toBeNull();
  });

  it("loads the open module's features, with their requirement counts", async () => {
    const tree = await listCatalogueTree({
      openProductId: await idOf("product", "PROD001"),
      openModuleId: await idOf("module", "MOD002")
    });
    const checkout = tree.products[0].modules?.find((m) => m.businessId === "MOD002");

    expect(checkout?.features?.map((f) => f.businessId)).toEqual(["FEAT001", "FEAT002"]);
    expect(checkout?.features?.map((f) => f.requirementCount)).toEqual([2, 1]);
    // Its sibling is open-product but closed-module, so still unfetched.
    expect(tree.products[0].modules?.find((m) => m.businessId === "MOD001")?.features).toBeNull();
  });

  // A module with no features must come back as [] once opened, not as null — that is
  // what tells the screen to offer "MOD001 has no features yet" rather than a chevron.
  it("distinguishes an opened empty branch from a closed one", async () => {
    const tree = await listCatalogueTree({
      openProductId: await idOf("product", "PROD001"),
      openModuleId: await idOf("module", "MOD001")
    });
    expect(tree.products[0].modules?.find((m) => m.businessId === "MOD001")?.features).toEqual([]);
  });

  // The tree stops at Feature. A feature is a leaf here, carrying only the count that
  // says whether opening the record is worth it — the requirements themselves are read in
  // the detail panel, which pages them. docs/adr/0001-catalogue-tree-stops-at-feature.md
  it("draws a feature as a leaf with its requirement count", async () => {
    const tree = await listCatalogueTree({
      openProductId: await idOf("product", "PROD001"),
      openModuleId: await idOf("module", "MOD002")
    });
    const [cardCapture, threeDS] = tree.products[0].modules?.[1].features ?? [];

    expect(cardCapture.requirementCount).toBe(2);
    expect(threeDS.requirementCount).toBe(1);
    expect(Object.keys(cardCapture).sort()).toEqual([
      "businessId",
      "id",
      "name",
      "requirementCount"
    ]);
  });

  // The cap, against a real database: a branch draws `childLimit` children and reports
  // the rest, so one wide module cannot decide how big the whole tree is.
  it("caps a branch and reports what it held back", async () => {
    const tree = await listCatalogueTree({
      openProductId: await idOf("product", "PROD001"),
      childLimit: 1
    });
    expect(tree.products[0].modules).toHaveLength(1);
    expect(tree.products[0].hiddenModules).toBe(1);
  });

  it("caps the product list itself", async () => {
    const tree = await listCatalogueTree({ childLimit: 1 });
    expect(tree.products.map((p) => p.businessId)).toEqual(["PROD001"]);
    expect(tree.hiddenProducts).toBe(1);
  });
});

describe("searchCatalogue", () => {
  const ids = (result: { hits: Array<{ businessId: string }> }) =>
    result.hits.map((h) => h.businessId);

  it("finds a feature and carries its ancestry", async () => {
    const result = await searchCatalogue("3-D Secure");

    expect(ids(result)).toEqual(["FEAT002"]);
    expect(result.hits[0].trail.map((t) => t.businessId)).toEqual(["PROD001", "MOD002"]);
    expect(result.hits[0].trail.map((t) => t.kind)).toEqual(["product", "module"]);
    expect(result.truncated).toBe(false);
  });

  it("matches a business ID as readily as a name, case-insensitively", async () => {
    expect(ids(await searchCatalogue("feat00")).sort()).toEqual(["FEAT001", "FEAT002", "FEAT003"]);
  });

  // A requirement is a first-class result. It has no row in the tree, so search is the
  // only way to reach one directly — and its whole statement is what was matched.
  it("finds a requirement by its statement, with all three ancestors", async () => {
    const result = await searchCatalogue("expired card");

    expect(ids(result)).toEqual(["REQ002"]);
    expect(result.hits[0].label).toBe("An expired card is refused");
    expect(result.hits[0].trail.map((t) => t.businessId)).toEqual([
      "PROD001",
      "MOD002",
      "FEAT001"
    ]);
  });

  it("matches a requirement by its business ID too", async () => {
    expect(ids(await searchCatalogue("REQ003"))).toEqual(["REQ003"]);
  });

  // An exact business ID is a lookup, not a search — nothing outranks it, whatever level
  // it is on. `MOD002` also appears inside no other record here, so this pins the ranking
  // rather than the filtering.
  it("ranks an exact business ID first", async () => {
    const result = await searchCatalogue("MOD002");
    expect(result.hits[0].businessId).toBe("MOD002");
  });

  // Interleaving is the thing four concatenated queries cannot do. "Card capture" is a
  // feature name and the first words of a requirement statement; the feature wins on both
  // score (prefix) and depth.
  it("interleaves levels by how well each answers the needle", async () => {
    const result = await searchCatalogue("card");
    expect(result.hits[0].businessId).toBe("FEAT001");
    expect(ids(result)).toContain("REQ001");
  });

  it("returns nothing for a needle that matches nothing", async () => {
    expect(await searchCatalogue("zzz-no-such-thing")).toEqual({ hits: [], truncated: false });
  });

  // A blank needle is not "everything" — it is not a search at all. Returning the whole
  // catalogue would be exactly the unbounded read this replaced.
  it("treats a blank needle as no search", async () => {
    expect(await searchCatalogue("   ")).toEqual({ hits: [], truncated: false });
  });

  // The bound, and the honesty about it: a list that silently stops has told the viewer
  // it found only that many.
  it("cuts at the limit and says so", async () => {
    const result = await searchCatalogue("00", { limit: 2 });
    expect(result.hits).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });
});

describe("getProductDetail", () => {
  it("returns the record, its modules, and the rollups beneath it", async () => {
    const detail = await getProductDetail("PROD001");

    expect(detail.kind).toBe("product");
    expect(detail.title).toBe("Retail Banking");
    expect(detail.trail).toEqual([]);
    expect(detail.product).toEqual({
      businessId: "PROD001",
      name: "Retail Banking",
      versionTag: "2.1",
      status: "Active"
    });
    // Rollups reach all the way down, not just one level.
    expect(detail.stats).toEqual({ modules: 2, features: 2, requirements: 3 });
    expect(detail.childKind).toBe("module");
    expect(detail.children.map((c) => c.businessId)).toEqual(["MOD001", "MOD002"]);
    expect(detail.children.map((c) => c.count)).toEqual([0, 2]);
  });

  it("resolves the last editor's display name", async () => {
    expect((await getProductDetail("PROD001")).updatedByName).toBe(LEAD_NAME);
  });

  it("is a 404 for a business ID that does not exist", async () => {
    await expect(getProductDetail("PROD999")).rejects.toBeInstanceOf(AppError);
    await expect(getProductDetail("PROD999")).rejects.toMatchObject({
      status: 404,
      code: "REFERENCE_NOT_FOUND"
    });
  });
});

describe("getModuleDetail", () => {
  it("carries the product as breadcrumb and as inherited attributes", async () => {
    const detail = await getModuleDetail("MOD002");

    expect(detail.title).toBe("Checkout");
    expect(detail.trail).toEqual([
      { kind: "product", businessId: "PROD001", name: "Retail Banking" }
    ]);
    // A module has no versionTag and no status of its own — these are the product's, and
    // the header must present them as inherited (CATALOGUE-EXPLORER-REDESIGN.md § 0.5).
    expect(detail.product.versionTag).toBe("2.1");
    expect(detail.product.status).toBe("Active");
  });

  it("counts requirements across all of its features", async () => {
    const detail = await getModuleDetail("MOD002");
    expect(detail.stats).toEqual({ modules: null, features: 2, requirements: 3 });
    expect(detail.children.map((c) => c.businessId)).toEqual(["FEAT001", "FEAT002"]);
    expect(detail.children.map((c) => c.count)).toEqual([2, 1]);
  });

  it("returns an empty child list for a module with no features", async () => {
    const detail = await getModuleDetail("MOD001");
    expect(detail.children).toEqual([]);
    expect(detail.childTotal).toBe(0);
    expect(detail.stats.requirements).toBe(0);
  });

  it("is a 404 for an unknown module", async () => {
    await expect(getModuleDetail("MOD999")).rejects.toMatchObject({ status: 404 });
  });
});

describe("getFeatureDetail", () => {
  it("lists requirements as leaf children, labelled by their statement", async () => {
    const detail = await getFeatureDetail("FEAT001");

    expect(detail.kind).toBe("feature");
    expect(detail.trail.map((t) => t.businessId)).toEqual(["PROD001", "MOD002"]);
    expect(detail.childKind).toBe("requirement");
    expect(detail.children.map((c) => c.businessId)).toEqual(["REQ001", "REQ002"]);
    expect(detail.children[0].label).toBe("A card number is validated before capture");
    // A requirement has nothing under it, and null says so — 0 would claim it was counted.
    expect(detail.children.every((c) => c.count === null)).toBe(true);
    expect(detail.stats).toEqual({ modules: null, features: null, requirements: 2 });
  });

  // The one paged child list on the screen.
  it("pages the requirement list while reporting the full total", async () => {
    const first = await getFeatureDetail("FEAT001", { page: 1, pageSize: 1 });
    expect(first.children.map((c) => c.businessId)).toEqual(["REQ001"]);
    expect(first.childTotal).toBe(2);

    const second = await getFeatureDetail("FEAT001", { page: 2, pageSize: 1 });
    expect(second.children.map((c) => c.businessId)).toEqual(["REQ002"]);
    expect(second.childTotal).toBe(2);
  });

  // Reachable without touching a URL: hold page 2 while a colleague deletes nothing but
  // the list shrinks by filter. ListEmpty needs the positive total to say so.
  it("reports a page past the end as empty rows with a positive total", async () => {
    const detail = await getFeatureDetail("FEAT001", { page: 9, pageSize: 1 });
    expect(detail.children).toEqual([]);
    expect(detail.childTotal).toBe(2);
  });

  it("returns an empty list for a feature with no requirements", async () => {
    const detail = await getFeatureDetail("FEAT003");
    expect(detail.children).toEqual([]);
    expect(detail.childTotal).toBe(0);
  });

  it("is a 404 for an unknown feature", async () => {
    await expect(getFeatureDetail("FEAT999")).rejects.toMatchObject({ status: 404 });
  });
});

describe("getRequirementDetail", () => {
  it("returns the leaf, with its whole ancestor chain", async () => {
    const detail = await getRequirementDetail("REQ002");

    expect(detail.kind).toBe("requirement");
    // The statement IS the title — a requirement has no name.
    expect(detail.title).toBe("An expired card is refused");
    expect(detail.trail.map((t) => t.businessId)).toEqual(["PROD001", "MOD002", "FEAT001"]);
    expect(detail.trail.map((t) => t.kind)).toEqual(["product", "module", "feature"]);
  });

  // Nothing hangs off a requirement. null childKind is what tells the panel to render no
  // child section at all, rather than an empty one implying something is missing.
  it("has no children and no rollups", async () => {
    const detail = await getRequirementDetail("REQ002");
    expect(detail.childKind).toBeNull();
    expect(detail.children).toEqual([]);
    expect(detail.childTotal).toBe(0);
    expect(detail.stats).toEqual({ modules: null, features: null, requirements: null });
  });

  // path is what the tree opens branches by; a selected requirement must expand all
  // three levels above it or it cannot be seen.
  it("carries the ancestor row ids the tree opens by", async () => {
    const detail = await getRequirementDetail("REQ002");
    expect(detail.path.productId).toBe(await idOf("product", "PROD001"));
    expect(detail.path.moduleId).toBe(await idOf("module", "MOD002"));
    expect(detail.path.featureId).toBe(await idOf("feature", "FEAT001"));
  });

  // Selecting a feature must open it too, or its requirements never appear in the tree.
  it("a feature opens its own branch", async () => {
    const detail = await getFeatureDetail("FEAT001");
    expect(detail.path.featureId).toBe(await idOf("feature", "FEAT001"));
  });

  it("inherits the product's version and status", async () => {
    const detail = await getRequirementDetail("REQ002");
    expect(detail.product.versionTag).toBe("2.1");
    expect(detail.product.status).toBe("Active");
    expect(detail.updatedByName).toBe(LEAD_NAME);
  });

  it("is a 404 for an unknown requirement", async () => {
    await expect(getRequirementDetail("REQ999")).rejects.toMatchObject({
      status: 404,
      code: "REFERENCE_NOT_FOUND"
    });
  });
});
