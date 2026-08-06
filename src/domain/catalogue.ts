import { Prisma, QamsRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { ensureRole, RoleSets } from "@/lib/rbac";
import { ensureVersion, requireNonBlank, requireNonBlankIfProvided } from "@/lib/validation";
import { withVersionCheck } from "@/lib/optimistic-lock";
import { BUSINESS_ID_PATTERNS, ensureBusinessIdFormat } from "@/lib/business-ids";
import { appendAudit } from "@/lib/audit";
import { runPaged, type PageRequest } from "@/lib/pagination";

type Actor = { userId: string; role: QamsRole; requestId: string };

/**
 * An in-flight transaction a caller already owns.
 *
 * The create functions below open their own transaction by default, which is right
 * for a route handler doing one thing. The workbook import is different: it must
 * "commit each dependency-consistent batch atomically"
 * (`docs/business-rules-and-validation.md:44`), so a per-row transaction would break
 * the property it is required to have. Accepting an existing client lets it call
 * these services from inside its batch instead of writing to Prisma directly, which
 * `docs/architecture.md:30` and `CLAUDE.md:52` both forbid.
 *
 * Every rule still runs — RBAC, non-blank checks, business-ID format, the duplicate
 * check and the audit event — because it is the same code path either way. That is
 * the entire point: one definition of what a valid Product is, not two.
 */
export type TxClient = Prisma.TransactionClient;

/** Run `fn` in the caller's transaction when there is one, otherwise open a new one. */
function runInTransaction<T>(
  tx: TxClient | undefined,
  fn: (client: TxClient) => Promise<T>
): Promise<T> {
  return tx ? fn(tx) : prisma.$transaction(fn);
}

/**
 * The catalogue lists take paging but no filter: the screen offers no search box, and
 * inventing one would be UI policy nobody asked for. `PageRequest` alone is enough to
 * stop the screen rendering every row of all four tables at once.
 */
export async function listProducts(options: PageRequest = {}) {
  return runPaged(
    options,
    (window) => prisma.product.findMany({ orderBy: { businessId: "asc" }, ...window }),
    () => prisma.product.count()
  );
}

/** Just enough of a parent to label a child row and fill an "Add" dropdown. */
const OPTION_SELECT = { id: true, businessId: true, name: true } as const;

/**
 * The parent options the catalogue screen needs whatever page it is on: a child row on
 * page 3 still has to name its parent, and the Add dialogs still have to offer every
 * possible parent. Deliberately NOT paged — but three columns per row rather than the
 * whole record, so the light thing is fetched in full and the heavy thing (the editable
 * rows, each carrying a server-action form) is what gets paged.
 */
export async function listCatalogueOptions() {
  const [products, modules, features] = await Promise.all([
    prisma.product.findMany({ select: OPTION_SELECT, orderBy: { businessId: "asc" } }),
    prisma.module.findMany({
      select: { ...OPTION_SELECT, productId: true },
      orderBy: { businessId: "asc" }
    }),
    prisma.feature.findMany({
      select: { ...OPTION_SELECT, moduleId: true },
      orderBy: { businessId: "asc" }
    })
  ]);
  return { products, modules, features };
}

/**
 * Products as filter options: every one, three columns, cheapest ordering.
 *
 * Separate from `listCatalogueOptions` because the list screens need only this third of
 * it — pulling modules and features to render one product dropdown is two queries and
 * two result sets thrown away on every page load. Unpaged: a dropdown that only offers
 * the first page of products is a filter that silently cannot reach some rows.
 */
export async function listProductOptions() {
  return prisma.product.findMany({ select: OPTION_SELECT, orderBy: { businessId: "asc" } });
}

/** Features as filter options, same shape and same reasoning as `listProductOptions`. */
export async function listFeatureOptions() {
  return prisma.feature.findMany({ select: OPTION_SELECT, orderBy: { businessId: "asc" } });
}

// The single-record getters exist so route handlers never touch the ORM directly
// (`architecture.md:33`) and a missing record surfaces through the standard error
// shape, requestId included (`api-and-security.md:22-31`) — implementation audit §4.2.
export async function getProduct(id: string) {
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) throw new AppError(404, "REFERENCE_NOT_FOUND", "Product not found.", "id");
  return product;
}

export async function createProduct(
  input: { businessId: string; name: string; versionTag: string; status: string },
  actor: Actor,
  txClient?: TxClient
) {
  ensureRole([...RoleSets.canAdmin], actor.role);
  requireNonBlank(input.businessId, "businessId", "Product ID is required.");
  requireNonBlank(input.name, "name", "Product name is required.");
  requireNonBlank(input.versionTag, "versionTag", "Version is required.");
  requireNonBlank(input.status, "status", "Status is required.");
  ensureBusinessIdFormat(input.businessId, BUSINESS_ID_PATTERNS.product, "businessId", "PROD###");

  const existing = await (txClient ?? prisma).product.findUnique({
    where: { businessId: input.businessId }
  });
  if (existing) {
    throw new AppError(409, "ID_DUPLICATE", "Product ID already exists.", "businessId");
  }

  return runInTransaction(txClient, async (tx) => {
    const created = await tx.product.create({
      data: {
        businessId: input.businessId.trim(),
        name: input.name.trim(),
        versionTag: input.versionTag.trim(),
        status: input.status.trim(),
        createdBy: actor.userId,
        updatedBy: actor.userId
      }
    });

    await appendAudit(tx, {
      actorId: actor.userId,
      action: "PRODUCT_CREATED",
      entityType: "Product",
      entityId: created.id,
      requestId: actor.requestId,
      beforeAfterJson: { after: created }
    });

    return created;
  });
}

export async function updateProduct(
  id: string,
  input: { name?: string; versionTag?: string; status?: string; version?: number },
  actor: Actor
) {
  ensureRole([...RoleSets.canAdmin], actor.role);
  requireNonBlankIfProvided(input.name, "name", "Product name cannot be blank.");
  requireNonBlankIfProvided(input.versionTag, "versionTag", "Version cannot be blank.");
  requireNonBlankIfProvided(input.status, "status", "Status cannot be blank.");
  const current = await prisma.product.findUnique({ where: { id } });
  if (!current) throw new AppError(404, "REFERENCE_NOT_FOUND", "Product not found.", "id");
  const expectedVersion = ensureVersion(current.version, input.version);

  return withVersionCheck(() => prisma.$transaction(async (tx) => {
    const updated = await tx.product.update({
      where: { id, version: expectedVersion },
      data: {
        name: input.name?.trim() ?? current.name,
        versionTag: input.versionTag?.trim() ?? current.versionTag,
        status: input.status?.trim() ?? current.status,
        version: { increment: 1 },
        updatedBy: actor.userId
      }
    });
    await appendAudit(tx, {
      actorId: actor.userId,
      action: "PRODUCT_UPDATED",
      entityType: "Product",
      entityId: id,
      requestId: actor.requestId,
      beforeAfterJson: { before: current, after: updated }
    });
    return updated;
  }));
}

export async function getModule(id: string) {
  const row = await prisma.module.findUnique({ where: { id } });
  if (!row) throw new AppError(404, "REFERENCE_NOT_FOUND", "Module not found.", "id");
  return row;
}

export async function listModules(options: PageRequest = {}) {
  return runPaged(
    options,
    (window) => prisma.module.findMany({ orderBy: { businessId: "asc" }, ...window }),
    () => prisma.module.count()
  );
}

export async function createModule(
  input: { businessId: string; name: string; productId: string },
  actor: Actor,
  txClient?: TxClient
) {
  ensureRole([...RoleSets.canAdmin], actor.role);
  requireNonBlank(input.businessId, "businessId", "Module ID is required.");
  requireNonBlank(input.name, "name", "Module name is required.");
  ensureBusinessIdFormat(input.businessId, BUSINESS_ID_PATTERNS.module, "businessId", "MOD###");

  const db = txClient ?? prisma;
  const product = await db.product.findUnique({ where: { id: input.productId } });
  if (!product) throw new AppError(404, "REFERENCE_NOT_FOUND", "Product not found.", "productId");

  const existing = await db.module.findUnique({ where: { businessId: input.businessId } });
  if (existing) throw new AppError(409, "ID_DUPLICATE", "Module ID already exists.", "businessId");

  return runInTransaction(txClient, async (tx) => {
    const created = await tx.module.create({
      data: {
        businessId: input.businessId.trim(),
        name: input.name.trim(),
        productId: input.productId,
        createdBy: actor.userId,
        updatedBy: actor.userId
      }
    });
    await appendAudit(tx, {
      actorId: actor.userId,
      action: "MODULE_CREATED",
      entityType: "Module",
      entityId: created.id,
      requestId: actor.requestId,
      beforeAfterJson: { after: created }
    });
    return created;
  });
}

export async function updateModule(id: string, input: { name?: string; version?: number }, actor: Actor) {
  ensureRole([...RoleSets.canAdmin], actor.role);
  requireNonBlankIfProvided(input.name, "name", "Module name cannot be blank.");
  const current = await prisma.module.findUnique({ where: { id } });
  if (!current) throw new AppError(404, "REFERENCE_NOT_FOUND", "Module not found.", "id");
  const expectedVersion = ensureVersion(current.version, input.version);

  return withVersionCheck(() => prisma.$transaction(async (tx) => {
    const updated = await tx.module.update({
      where: { id, version: expectedVersion },
      data: { name: input.name?.trim() ?? current.name, version: { increment: 1 }, updatedBy: actor.userId }
    });
    await appendAudit(tx, {
      actorId: actor.userId,
      action: "MODULE_UPDATED",
      entityType: "Module",
      entityId: id,
      requestId: actor.requestId,
      beforeAfterJson: { before: current, after: updated }
    });
    return updated;
  }));
}

export async function getFeature(id: string) {
  const row = await prisma.feature.findUnique({ where: { id } });
  if (!row) throw new AppError(404, "REFERENCE_NOT_FOUND", "Feature not found.", "id");
  return row;
}

export async function listFeatures(options: PageRequest = {}) {
  return runPaged(
    options,
    (window) => prisma.feature.findMany({ orderBy: { businessId: "asc" }, ...window }),
    () => prisma.feature.count()
  );
}

export async function createFeature(
  input: { businessId: string; name: string; moduleId: string },
  actor: Actor,
  txClient?: TxClient
) {
  ensureRole([...RoleSets.canAdmin], actor.role);
  requireNonBlank(input.businessId, "businessId", "Feature ID is required.");
  requireNonBlank(input.name, "name", "Feature name is required.");
  ensureBusinessIdFormat(input.businessId, BUSINESS_ID_PATTERNS.feature, "businessId", "FEAT###");

  const db = txClient ?? prisma;
  const parentModule = await db.module.findUnique({ where: { id: input.moduleId } });
  if (!parentModule) throw new AppError(404, "REFERENCE_NOT_FOUND", "Module not found.", "moduleId");

  const existing = await db.feature.findUnique({ where: { businessId: input.businessId } });
  if (existing) throw new AppError(409, "ID_DUPLICATE", "Feature ID already exists.", "businessId");

  return runInTransaction(txClient, async (tx) => {
    const created = await tx.feature.create({
      data: {
        businessId: input.businessId.trim(),
        name: input.name.trim(),
        moduleId: input.moduleId,
        createdBy: actor.userId,
        updatedBy: actor.userId
      }
    });
    await appendAudit(tx, {
      actorId: actor.userId,
      action: "FEATURE_CREATED",
      entityType: "Feature",
      entityId: created.id,
      requestId: actor.requestId,
      beforeAfterJson: { after: created }
    });
    return created;
  });
}

export async function updateFeature(id: string, input: { name?: string; version?: number }, actor: Actor) {
  ensureRole([...RoleSets.canAdmin], actor.role);
  requireNonBlankIfProvided(input.name, "name", "Feature name cannot be blank.");
  const current = await prisma.feature.findUnique({ where: { id } });
  if (!current) throw new AppError(404, "REFERENCE_NOT_FOUND", "Feature not found.", "id");
  const expectedVersion = ensureVersion(current.version, input.version);

  return withVersionCheck(() => prisma.$transaction(async (tx) => {
    const updated = await tx.feature.update({
      where: { id, version: expectedVersion },
      data: { name: input.name?.trim() ?? current.name, version: { increment: 1 }, updatedBy: actor.userId }
    });
    await appendAudit(tx, {
      actorId: actor.userId,
      action: "FEATURE_UPDATED",
      entityType: "Feature",
      entityId: id,
      requestId: actor.requestId,
      beforeAfterJson: { before: current, after: updated }
    });
    return updated;
  }));
}

export async function getRequirement(id: string) {
  const row = await prisma.requirement.findUnique({ where: { id } });
  if (!row) throw new AppError(404, "REFERENCE_NOT_FOUND", "Requirement not found.", "id");
  return row;
}

export async function listRequirements(options: PageRequest = {}) {
  return runPaged(
    options,
    (window) => prisma.requirement.findMany({ orderBy: { businessId: "asc" }, ...window }),
    () => prisma.requirement.count()
  );
}

export async function createRequirement(
  input: { businessId: string; statement: string; featureId: string },
  actor: Actor,
  txClient?: TxClient
) {
  ensureRole([...RoleSets.canAdmin], actor.role);
  requireNonBlank(input.businessId, "businessId", "Requirement ID is required.");
  requireNonBlank(input.statement, "statement", "Requirement statement is required.");
  ensureBusinessIdFormat(input.businessId, BUSINESS_ID_PATTERNS.requirement, "businessId", "REQ###");

  const db = txClient ?? prisma;
  const feature = await db.feature.findUnique({ where: { id: input.featureId } });
  if (!feature) throw new AppError(404, "REFERENCE_NOT_FOUND", "Feature not found.", "featureId");

  const existing = await db.requirement.findUnique({ where: { businessId: input.businessId } });
  if (existing) throw new AppError(409, "ID_DUPLICATE", "Requirement ID already exists.", "businessId");

  return runInTransaction(txClient, async (tx) => {
    const created = await tx.requirement.create({
      data: {
        businessId: input.businessId.trim(),
        statement: input.statement.trim(),
        featureId: input.featureId,
        createdBy: actor.userId,
        updatedBy: actor.userId
      }
    });
    await appendAudit(tx, {
      actorId: actor.userId,
      action: "REQUIREMENT_CREATED",
      entityType: "Requirement",
      entityId: created.id,
      requestId: actor.requestId,
      beforeAfterJson: { after: created }
    });
    return created;
  });
}

export async function updateRequirement(
  id: string,
  input: { statement?: string; version?: number },
  actor: Actor
) {
  ensureRole([...RoleSets.canAdmin], actor.role);
  requireNonBlankIfProvided(input.statement, "statement", "Requirement statement cannot be blank.");
  const current = await prisma.requirement.findUnique({ where: { id } });
  if (!current) throw new AppError(404, "REFERENCE_NOT_FOUND", "Requirement not found.", "id");
  const expectedVersion = ensureVersion(current.version, input.version);

  return withVersionCheck(() => prisma.$transaction(async (tx) => {
    const updated = await tx.requirement.update({
      where: { id, version: expectedVersion },
      data: { statement: input.statement?.trim() ?? current.statement, version: { increment: 1 }, updatedBy: actor.userId }
    });
    await appendAudit(tx, {
      actorId: actor.userId,
      action: "REQUIREMENT_UPDATED",
      entityType: "Requirement",
      entityId: id,
      requestId: actor.requestId,
      beforeAfterJson: { before: current, after: updated }
    });
    return updated;
  }));
}
