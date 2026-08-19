# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Quality Assurance Management System (QAMS): a Next.js 15 (App Router) + TypeScript modular monolith with a REST/JSON API under `/api/v1`, a server-rendered web interface under `src/app/(app)/` (screens derive from the role/capability matrix — see `docs/architecture.md` § "Web interface" and `src/ui/navigation.ts`), PostgreSQL via Prisma 7 (`@prisma/adapter-pg`), and Zod for request validation. Screen mutations go through server actions (`src/ui/action.ts`) that call exactly one domain service, the same contract as route handlers.

## Commands

`package.json` holds the scripts and `npm run` lists them. The one thing it does not say:
`prisma:seed` requires the `SEED_QA_LEAD_PASSWORD` env var.

Environment: copy `.env.example` to `.env`; requires `DATABASE_URL` (local PostgreSQL) and `SESSION_SECRET`. Prisma config (schema path, seed command) lives in `prisma.config.ts`.

## Documentation is the source of truth

`docs/` is the single source of truth for all policy and business rules. When documents conflict, the authority order (defined in `docs/README.md`) is: business-rules-and-validation → roles-workflows → data-model → api-and-security → architecture → sops → excel-source-map → ai-agent-governance.

Do not fill policy gaps from general QA practice or assumptions — if the docs don't establish something, say so and escalate to the QA Lead. Any policy change must update the affected doc, the acceptance scenarios in `docs/testing-and-acceptance.md`, and cross-references in `docs/skills/qa-management-system/SKILL.md` (a project-local, read-only copilot skill that must link to policy docs, never duplicate policy values).

## Architecture

Strict layering — route handlers must stay thin:

- **`src/app/api/v1/**/route.ts`** — route handlers only authenticate, validate request shape, call one domain service, and return. Every handler wraps its logic in `withRoute()` from `src/lib/route.ts`, which runs `requireAuth()` and maps thrown errors to JSON responses.
- **`src/domain/*.ts`** — domain services (catalogue, test-cases, executions, defects, traceability, imports, admin) own all business rules, RBAC checks, lifecycle transitions, atomic persistence, and audit emission. All multi-record mutations run inside a Prisma transaction and call `appendAudit()` with the transaction client.
- **`src/lib/*.ts`** — shared infrastructure: `db.ts` (Prisma singleton), `errors.ts`, `rbac.ts`, `auth.ts`/`session.ts`, `validation.ts`, `business-ids.ts`, `controlled-values.ts`, `audit.ts`.

Key conventions enforced across the codebase:

- **Errors:** throw `AppError(status, code, message, field?)` with a stable `ErrorCode` from `src/lib/errors.ts` (e.g. `HIERARCHY_MISMATCH`, `VERSION_CONFLICT`, `FORBIDDEN_TRANSITION`). Never return ad-hoc error shapes.
- **RBAC:** roles are `QA_TESTER < QA_ENGINEER < SENIOR_QA_ENGINEER < QA_LEAD`. Check permissions with `ensureRole(RoleSets.x, actor.role)` (`src/lib/rbac.ts`). The effective role is always derived server-side from the session cookie; clients never submit a role.
- **Lifecycles:** enums in `prisma/schema.prisma` define the state machines — test case (DRAFT → IN_REVIEW → APPROVED → RETIRED), execution (PLANNED → IN_PROGRESS → FINALIZED), defect (NEW → TRIAGED → IN_PROGRESS → RESOLVED → CLOSED). Transitions are explicit route endpoints (e.g. `test-cases/[id]/approve`, `executions/[id]/finalize`) and must follow the transition rules in `docs/roles-workflows.md` (e.g. authors cannot approve their own test cases; finalized executions are immutable — history is append-only via `ExecutionHistory`).
- **Optimistic concurrency:** every mutable entity carries a `version` int; mutations verify it (`ensureVersion`) and increment it, else throw `VERSION_CONFLICT`.
- **Business IDs:** human-facing IDs are validated against `BUSINESS_ID_PATTERNS` in `src/lib/business-ids.ts` (e.g. `PROD001`, `TC-<tag>-0001`, `BUG-0001`) and unique in the database.
- **Controlled values:** the catalogues are Priority, Severity, and Result. Fields backed by them (priority, severity) must match an active `ControlledValue` row via `ensureActiveControlledValue`. Cycle, sprint, release, and environment are required free-text attributes with no master entity of their own (`docs/data-model.md`) — do not validate them against a catalogue.
- **Hierarchy:** Product → Module → Feature → Requirement. Services validate that referenced entities actually chain together (`HIERARCHY_MISMATCH` otherwise).
- **Audit:** every create/update/transition/import/role change appends an `AuditEvent` (actor, action, entity, requestId, before/after JSON). The audit log is append-only.

The Excel workbook (`docs/excel-source-map.md`) is a one-time seed source imported through the validated import service (`src/domain/imports.ts`, `xlsx` package) — never a live authority, and imports must not bypass domain services.

Acceptance scenarios in `docs/testing-and-acceptance.md` define the expected behavior (exact status codes and error codes) for the whole system — treat them as the spec when implementing or changing endpoints.
