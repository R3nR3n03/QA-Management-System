import { QamsRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { ensureRole, RoleSets } from "@/lib/rbac";
import { ensureVersion, requireNonBlank, requireNonBlankIfProvided } from "@/lib/validation";
import { withVersionCheck } from "@/lib/optimistic-lock";
import { BUSINESS_ID_PATTERNS, ensureBusinessIdFormat } from "@/lib/business-ids";
import { appendAudit } from "@/lib/audit";

type Actor = { userId: string; role: QamsRole; requestId: string };

export async function listProducts() {
  return prisma.product.findMany({ orderBy: { businessId: "asc" } });
}

export async function createProduct(
  input: { businessId: string; name: string; versionTag: string; status: string },
  actor: Actor
) {
  ensureRole([...RoleSets.canAdmin], actor.role);
  requireNonBlank(input.businessId, "businessId", "Product ID is required.");
  requireNonBlank(input.name, "name", "Product name is required.");
  requireNonBlank(input.versionTag, "versionTag", "Version is required.");
  requireNonBlank(input.status, "status", "Status is required.");
  ensureBusinessIdFormat(input.businessId, BUSINESS_ID_PATTERNS.product, "businessId", "PROD###");

  const existing = await prisma.product.findUnique({ where: { businessId: input.businessId } });
  if (existing) {
    throw new AppError(409, "ID_DUPLICATE", "Product ID already exists.", "businessId");
  }

  return prisma.$transaction(async (tx) => {
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

export async function listModules() {
  return prisma.module.findMany({ orderBy: { businessId: "asc" } });
}

export async function createModule(
  input: { businessId: string; name: string; productId: string },
  actor: Actor
) {
  ensureRole([...RoleSets.canAdmin], actor.role);
  requireNonBlank(input.businessId, "businessId", "Module ID is required.");
  requireNonBlank(input.name, "name", "Module name is required.");
  ensureBusinessIdFormat(input.businessId, BUSINESS_ID_PATTERNS.module, "businessId", "MOD###");

  const product = await prisma.product.findUnique({ where: { id: input.productId } });
  if (!product) throw new AppError(404, "REFERENCE_NOT_FOUND", "Product not found.", "productId");

  const existing = await prisma.module.findUnique({ where: { businessId: input.businessId } });
  if (existing) throw new AppError(409, "ID_DUPLICATE", "Module ID already exists.", "businessId");

  return prisma.$transaction(async (tx) => {
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

export async function listFeatures() {
  return prisma.feature.findMany({ orderBy: { businessId: "asc" } });
}

export async function createFeature(
  input: { businessId: string; name: string; moduleId: string },
  actor: Actor
) {
  ensureRole([...RoleSets.canAdmin], actor.role);
  requireNonBlank(input.businessId, "businessId", "Feature ID is required.");
  requireNonBlank(input.name, "name", "Feature name is required.");
  ensureBusinessIdFormat(input.businessId, BUSINESS_ID_PATTERNS.feature, "businessId", "FEAT###");

  const parentModule = await prisma.module.findUnique({ where: { id: input.moduleId } });
  if (!parentModule) throw new AppError(404, "REFERENCE_NOT_FOUND", "Module not found.", "moduleId");

  const existing = await prisma.feature.findUnique({ where: { businessId: input.businessId } });
  if (existing) throw new AppError(409, "ID_DUPLICATE", "Feature ID already exists.", "businessId");

  return prisma.$transaction(async (tx) => {
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

export async function listRequirements() {
  return prisma.requirement.findMany({ orderBy: { businessId: "asc" } });
}

export async function createRequirement(
  input: { businessId: string; statement: string; featureId: string },
  actor: Actor
) {
  ensureRole([...RoleSets.canAdmin], actor.role);
  requireNonBlank(input.businessId, "businessId", "Requirement ID is required.");
  requireNonBlank(input.statement, "statement", "Requirement statement is required.");
  ensureBusinessIdFormat(input.businessId, BUSINESS_ID_PATTERNS.requirement, "businessId", "REQ###");

  const feature = await prisma.feature.findUnique({ where: { id: input.featureId } });
  if (!feature) throw new AppError(404, "REFERENCE_NOT_FOUND", "Feature not found.", "featureId");

  const existing = await prisma.requirement.findUnique({ where: { businessId: input.businessId } });
  if (existing) throw new AppError(409, "ID_DUPLICATE", "Requirement ID already exists.", "businessId");

  return prisma.$transaction(async (tx) => {
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
