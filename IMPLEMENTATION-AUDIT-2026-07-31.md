# QAMS Implementation Re-Audit — Docs vs. Code

**Date:** 2026-07-31 · **Revised:** 2026-07-31 — §5.10 added (the documented web interface does not exist), missed by the original pass. §5 retitled and §7 extended accordingly; no other finding changed.
**Scope:** `src/`, `prisma/schema.prisma`, `prisma/seed.ts`, and the route tree under `src/app/api/v1`, checked against `docs/` in the authority order defined in `docs/README.md`. The original pass scoped itself to the API, domain services and schema, and did not check `docs/` for commitments about the user interface — that omission is what §5.10 corrects.
**Baseline:** the previous audit at `.relay/runs/2026-07-29-workbook-import/implementation-audit.md` (2026-07-29). This document supersedes it.
**Repository state at audit:** `db79c32` — "Bootstrap the documented controlled-value catalogues".

**Status legend:** **CRITICAL** (live exposure or documented rule defeated) · **HIGH** (documented rule not met; data-integrity or contract impact) · **MEDIUM** (works, but violates a documented convention) · **OPEN** (carried unchanged from the previous audit) · **NOTE** (gap in the docs themselves — escalate to the QA Lead, do not fill from general QA practice).

This document is deliberately **outside `docs/`**. `docs/` is the approved single source of truth for policy; an audit report is neither policy nor approved. Nothing here amends any documented rule.

---

## 0. Verification performed

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | Passes, no errors |
| `npx vitest run` | 9 tests / 2 files, all passing |
| Acceptance scenarios from `docs/testing-and-acceptance.md` automated | **0 of 17** |
| Secrets committed | None — `.env` is correctly gitignored; only `.env.example` is tracked |

---

## 1. Change since the 2026-07-29 audit

**Closed — item 2, controlled-value bootstrap.** `prisma/seed.ts` and `src/lib/controlled-value-catalogues.ts` now seed the nine documented values from `docs/excel-source-map.md:38-46`, with unit tests in `src/lib/controlled-value-catalogues.test.ts`. The seed is idempotent, its `update: {}` no-op correctly refuses to resurrect a value a QA Lead deactivated, and it deliberately omits the legacy `Not Executed` value per `excel-source-map.md:46`. No defects found in this work.

**Every other item from that audit remains open** (§5 below). Additionally, that audit did not report the findings in §2 and §3 — including a lifecycle bypass that defeats two of its own "verified as implemented" claims.

---

## 2. CRITICAL

### 2.1 Lifecycle bypass via mass-assignment in `createTestCase`

**Where:** `src/domain/test-cases.ts:93-105`, reached from `src/app/api/v1/test-cases/route.ts:31`.

```ts
// src/domain/test-cases.ts:94
const created = await tx.testCase.create({
  data: {
    ...input,                       // <-- line 96: the raw request body
    businessId: input.businessId.trim(),
    title: input.title.trim(),
    objective: input.objective.trim(),
    expectedResult: input.expectedResult.trim(),
    authorUserId: actor.userId,     // overridden — safe
    createdBy: actor.userId,        // overridden — safe
    updatedBy: actor.userId         // overridden — safe
  }
});
```

`input` is the unvalidated JSON body: the route calls `parseJson<T>()`, which is a bare TypeScript cast with no runtime check (§2.3), and passes the object straight through. The explicit overrides after the spread protect `authorUserId`, `createdBy`, and `updatedBy` — but **`lifecycleState` is not overridden**, and Prisma's `TestCaseUncheckedCreateInput` accepts it.

**Exploit.** Any user holding `canAuthor` (QA Engineer and above) issues:

```json
POST /api/v1/test-cases
{ "businessId": "TC-DEMO-0001", "productId": "…", "moduleId": "…", "featureId": "…",
  "requirementId": "…", "cycle": "C1", "sprint": "S1", "release": "R1",
  "environment": "QA", "priority": "High", "severity": "Major",
  "title": "…", "objective": "…", "expectedResult": "…",
  "lifecycleState": "APPROVED" }
```

The case is persisted **Approved in a single request**, never passing through Draft → In Review → Approved. Executions can then be created against it (`executions.ts:27` only checks that the state *is* `APPROVED`).

**Rules defeated:**
- `docs/roles-workflows.md:23-28` — the entire test-case transition table, including "In Review → Approved | Senior QA Engineer (**not author**), QA Lead".
- `docs/roles-workflows.md:12` — "Review and approve test cases | QA Tester: No | QA Engineer: **No** | …".
- `docs/testing-and-acceptance.md:12` — "Author attempts own approval → `403`; no transition."
- `docs/testing-and-acceptance.md:13` — "Senior QA Engineer approves another author's valid review → State becomes Approved; **audit event exists**." The bypass produces an Approved case with no `TEST_CASE_APPROVED` audit event at all.

The same vector also injects `version` (breaking optimistic concurrency from the first write), `reviewReason`, and `retirementReason`. `revisesTestCaseId` is injectable but is separately validated at `test-cases.ts:73-86`.

**Fix.** Never spread a request body into a Prisma `data` object. Enumerate the writable fields explicitly, and set `lifecycleState: TestCaseLifecycleState.DRAFT` unconditionally on create. Validating the body with a strict schema (§2.3) closes it at the boundary as well; do both.

### 2.2 `passwordHash` is returned by the API

**Where:** `src/app/api/v1/users/[id]/role/route.ts:20`, with `src/domain/admin.ts:51-54`.

`updateUserRole` returns the full Prisma `User` record from `tx.user.update(...)`, and the route returns it verbatim: `return Response.json(updated);`. The response body therefore contains `passwordHash`.

**Rule violated:** `docs/data-model.md:35` — "passwordHash is never returned by the API or written to audit logs."

The audit half of that rule is correctly honoured (`admin.ts:61` writes only `{ before: { role }, after: { role } }`). Only the HTTP response leaks. Exposure is limited to QA Leads (the only role that can reach the endpoint), and the hash is scrypt with a per-user salt (`src/lib/password.ts`), so this is not an immediate credential compromise — but it is a plain violation of an explicit, absolute rule, and it is a two-line fix.

**Fix.** Return an explicit projection (`id`, `email`, `displayName`, `role`, `active`, `version`) from the domain service. Audit every other place a `User` row could reach a response at the same time.

### 2.3 No request-boundary validation exists

**Where:** everywhere. `src/lib/request.ts:10-16`.

```ts
export async function parseJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;   // line 12 — a cast, not a check
  } catch { throw new AppError(422, "ID_INVALID", "Invalid JSON body."); }
}
```

`zod` is declared at `package.json:28` and **imported by zero files in `src/`**. Every route handler casts the body to a shape it then trusts.

**Rules violated:**
- `docs/api-and-security.md:40` — "Validate JSON shape, scalar lengths, enums, and IDs at the request boundary; re-check business rules in services."
- `docs/architecture.md:33` — "route handlers only authenticate, **validate request shape**, call a service, and map known failures to API responses."
- `CLAUDE.md:7` states the project uses "Zod for request validation". It does not.

This is the root cause of §2.1, §3.3 and §3.7, and of the systematic 500-instead-of-422 behaviour catalogued below — `docs/business-rules-and-validation.md:5` requires "Every rejected request returns HTTP `422` with stable error code, field path, and human-readable message."

**Fix.** One `z.object({...}).strict()` per route, parsed in the handler before the domain call. `.strict()` matters: it is what makes an unexpected `lifecycleState` key a 422 instead of a silent write.

---

## 3. HIGH

### 3.1 Optimistic concurrency is not atomic — lost updates are possible

**Where:** every mutating domain function. Representative: `src/domain/catalogue.ts:65-79`; identical pattern in `test-cases.ts:145-171`, `:192-220`, `:236-264`, `:279-297`, `:317-333`, `:353-369`; `executions.ts:72-89`, `:120-193`; `defects.ts:69-89`, `:125-188`; `admin.ts:17-29`, `:46-54`.

The shape is always:

```ts
const current = await prisma.product.findUnique({ where: { id } });  // outside the transaction
ensureVersion(current.version, input.version);                        // check
return prisma.$transaction(async (tx) => {
  const updated = await tx.product.update({
    where: { id },                                                    // <-- version absent
    data: { …, version: { increment: 1 } }
  });
```

The read happens outside the transaction and the version never reaches the `WHERE` clause. Two concurrent PATCHes that both read `version: 1` both pass `ensureVersion` and both write; the second silently overwrites the first and the row lands at `version: 3`. No `VERSION_CONFLICT` is raised.

**Rules violated:** `docs/business-rules-and-validation.md:15` and `docs/api-and-security.md:5` — the optimistic `version` contract is nominally present but does not actually serialise concurrent writers.

**Fix.** Move the check into the write: `where: { id, version: expected }`, and treat Prisma's "record not found" (P2025) as `409 VERSION_CONFLICT`. Do the read inside the transaction too.

### 3.2 Uniqueness races return 500 instead of 409

**Where:** `catalogue.ts:26-29`, `:108-109`, `:173-174`, `:238-239`; `test-cases.ts:88-91`; `executions.ts:36-39`; `defects.ts:32-35`; `executions.ts:148-151`.

Each does `findUnique` for an existing business ID, then `create` inside the transaction. Under concurrency the pre-check passes for both callers and the database unique constraint rejects the loser with Prisma `P2002`. `asErrorResponse` (`src/lib/errors.ts:44-53`) has no `PrismaClientKnownRequestError` branch, so the caller receives `500 INTERNAL_ERROR`.

**Rules violated:** `docs/business-rules-and-validation.md:5` — "conflicting record versions or business IDs return `409`" — and `:11` (`ID_DUPLICATE`). `docs/architecture.md:46` explicitly designs for the database as the second line of defence ("Enforce unique business IDs and foreign keys in PostgreSQL **in addition to** service validation"); the constraint fires correctly, but the error mapping discards it.

**Fix.** Map `P2002` → `409 ID_DUPLICATE` (field from `err.meta.target`), `P2025` → `409 VERSION_CONFLICT`, `P2003` → `422 REFERENCE_NOT_FOUND`, in `asErrorResponse`.

### 3.3 `POST /executions/{id}/finalize` returns 500 on three ordinary bad inputs

**Where:** `src/domain/executions.ts:116-215`.

| Input | Behaviour | Documented behaviour |
| --- | --- | --- |
| `result` omitted | No branch at `:128-136` fires. `tx.executionHistory.create({ result: undefined })` violates a required non-null column → transaction aborts → **500** | `422`; `roles-workflows.md:39` — an execution has result Pass, Fail, or Blocked only at Finalized |
| `result` not a valid enum value (e.g. `"MAYBE"`) | Same path; Prisma enum error → **500** | `422 CONTROLLED_VALUE_INVALID` or equivalent |
| `createDefect` present with `priority` omitted | Validated conditionally at `:142` (`if (input.createDefect.priority?.trim())`) but dereferenced unconditionally at `:163` (`input.createDefect.priority.trim()`) → `TypeError` → **500** | `422` per `business-rules-and-validation.md:5` |

The `priority`/`severity` pair at `:142-147` and `:163-164` is a straightforward guard/use mismatch: the guard admits `undefined`, the use assumes a string. `defects.ts:43-44` handles the identical case correctly with `?? ""` — the two paths disagree.

### 3.4 Reopen reason is required, validated, then discarded

**Where:** `src/domain/defects.ts:172-174`, audit at `:189-196`.

```ts
if (input.targetStatus === IN_PROGRESS && defect.status === RESOLVED) {
  requireNonBlank(input.reopenReason, "reopenReason", "Reopen reason is required.");
}
```

`reopenReason` is never persisted — there is no column on `Defect` for it (`prisma/schema.prisma:230-251`) — and it is not written to the audit event, which records only `{ before: { status }, after: { status } }`.

**Rule violated:** `docs/roles-workflows.md:49` — "Resolved | In Progress | Senior QA Engineer, QA Lead | **Reopen reason recorded**". The reason is demanded from the caller and then dropped; nothing in the system can answer why a defect was reopened.

The same audit event also omits `resolutionSummary`, `closureRationale`, and `retestEvidenceRef` on the transitions that require them, against `docs/business-rules-and-validation.md:50` ("a redacted before/after summary"). Those three at least reach their columns; the reopen reason reaches nothing.

**Fix.** Either add a `reopenReason` column (mirroring `reviewReason`/`retirementReason` on `TestCase`) or record it in the audit event — the doc says "recorded", not "stored on the record", so either satisfies it. Include the other transition rationales in the audit payload while there.

### 3.5 The RTM uniqueness constraint does not work for the common case

**Where:** `prisma/schema.prisma:277`, `src/domain/traceability.ts:55-63`.

`@@unique([requirementId, testCaseId, defectId])` with `defectId String?`. In PostgreSQL, `NULL` values are never equal, so the constraint **does not deduplicate any link without a defect** — and `docs/business-rules-and-validation.md:36` explicitly contemplates those ("The system permits an RTM link without a defect"). Unlimited identical `(requirement, testCase, null)` rows are insertable. `createRtmLink` has no duplicate pre-check of its own.

When the constraint *does* fire (same requirement + test case + same non-null defect), there is no `P2002` handling, so the caller gets 500 rather than 409 (§3.2).

**Rule violated:** `docs/data-model.md:27` — "RTM link | … | unique `(requirementId, testCaseId, defectId)`".

**Fix.** Add a partial unique index for the `defectId IS NULL` case, or make the column non-nullable with a sentinel; plus an explicit duplicate check in the service.

### 3.6 No structured logging exists

**Where:** nowhere. `src/` contains no logger, and no `console.*` call.

**Rule violated:** `docs/architecture.md:47` — "Capture structured logs with request ID, actor ID, action, outcome, and error code; never log credentials or evidence contents."

`requestMetadata()` generates a `requestId` and `asErrorResponse` returns it to the client, but it is never emitted anywhere server-side, so a `requestId` from an error body cannot be correlated with anything. Every 500 in this document is currently invisible in operation: the error is swallowed at `errors.ts:44` and replaced with "Unexpected error." with no record of what was thrown.

**Fix.** Log at the `withRoute` boundary (`src/lib/route.ts:17-19`) — one structured line per request outcome, and the caught error's detail on the 500 path. The audit event covers *business* history; this covers *operational* history, and they are not substitutes.

### 3.7 Malformed request bodies produce 500

**Where:** `src/lib/request.ts:10-16`, `src/app/api/v1/auth/login/route.ts:12`.

`parseJson` catches unparseable JSON but not *parseable non-object* JSON. A body of literal `null` (or `[]`, or `"x"`) parses fine, then `body.email?.trim()` at `login/route.ts:12` throws `TypeError` on `null` → 500. Every route that dereferences a body field has the same shape. Covered by the §2.3 fix.

---

## 4. MEDIUM

### 4.1 The `Result` controlled-value catalogue is dead data

Seeded per `docs/excel-source-map.md:44` (`Pass`, `Fail`, `Blocked`) by `src/lib/controlled-value-catalogues.ts:49-51`, and `CATALOGUE_RESULT` is exported — but it is never passed to `ensureActiveControlledValue` anywhere. Execution result is the Prisma `ExecutionOutcome` enum (`schema.prisma:29-33`). A QA Lead deactivating `Blocked` through `PATCH /controlled-values` changes nothing.

**NOTE — needs a QA Lead ruling.** `docs/data-model.md:40` says both that "Controlled catalogues initially contain the workbook values for priority, severity, and **execution result**" and that "The application also owns lifecycle values defined in `roles-workflows.md`; they are not editable configuration in v1." Execution result sits in the overlap. Either the Result catalogue should not be seeded, or the enum should be validated against it — that is a policy decision, not an implementation one. Do not resolve it in code.

### 4.2 Direct-ORM GET handlers: seven routes, not one

The previous audit reported this for `imports/[id]` alone. It applies to every single-record GET:

`products/[id]`, `modules/[id]`, `features/[id]`, `requirements/[id]`, `test-cases/[id]`, `defects/[id]`, `imports/[id]` — each calls `prisma.*.findUnique` in the handler and hand-builds a 404 body:

```ts
Response.json({ error: { code: "REFERENCE_NOT_FOUND", message: "…" } }, { status: 404 })
```

**Rules violated:** `docs/api-and-security.md:18` ("Every mutation routes through its domain service; direct ORM calls from route handlers are prohibited" — mutations are named, but `architecture.md:33` extends the constraint to handlers generally) and `docs/api-and-security.md:22-31`, which specifies `requestId` as part of the error body. None of these seven include it. `auth/login` also touches Prisma directly, which is defensible for the credential check but is the eighth such route.

### 4.3 Defects persist empty-string priority and severity

`src/domain/defects.ts:43-44` writes `input.priority?.trim() ?? ""` into non-nullable columns. `docs/business-rules-and-validation.md:30` reads "A defect requires test case, non-blank summary, status, priority, and severity. New defects may omit investigation owner and resolution summary; **Triaged defects require priority and severity**." The code takes the lenient reading — correct, and necessary, because `docs/excel-source-map.md:20` states the Bug Tracker sheet has no priority or severity and forbids inventing them. But `""` in a non-nullable column makes "absent" and "blank" indistinguishable in data, and it means the row violates the first sentence of `:30` as literally written.

**NOTE.** The two sentences of `business-rules-and-validation.md:30` are in tension. The lenient reading is the only one compatible with `excel-source-map.md:20`, but it should be made explicit in the doc rather than inferred. Nullable columns would then be the honest representation.

---

## 5. OPEN — larger gaps

Items 5.1–5.9 are carried unchanged from the 2026-07-29 audit. **Item 5.10 is new to this
revision** — it was missed by both audits and is recorded in full below the table.

| # | Item | Evidence |
| --- | --- | --- |
| 5.1 | **Workbook import is still a stub.** `src/domain/imports.ts` is 52 lines: it checks the 13 sheet names exist and writes one `ImportRun` with `status: "VALIDATED"`. No header validation, row parsing, staging, dependency-ordered atomic commit, `SKIPPED_UNCHANGED`/`RECONCILIATION_REQUIRED` outcomes, `ImportRowReport` rows, rejection handling, dashboard recalculation, `sourceFileHash`, or `completedAt`. | `docs/excel-source-map.md:25-34`, `business-rules-and-validation.md:40-46`, `api-and-security.md:45-47`, 4 acceptance scenarios in `testing-and-acceptance.md:8-10` |
| 5.2 | **Reconciliation follow-up operation absent.** A well-formed proposal exists at `RECONCILIATION-POLICY-AMENDMENT-DRAFT.md`, correctly parked outside `docs/` pending QA Lead approval. Two of its eight decisions are conflicts between authoritative documents and must be settled by the QA Lead regardless. | `api-and-security.md:47` |
| 5.3 | **`GET /users/{id}/role` not implemented** — only `PATCH` exists. | `api-and-security.md:16` |
| 5.4 | **No pagination, filtering, or sorting** on any collection endpoint. Every list is an unbounded `findMany` with a fixed `orderBy`. **NOTE:** the docs never enumerate the "documented fields" per resource — escalate before implementing. | `api-and-security.md:5` |
| 5.5 | **No rate limiting** on auth or import endpoints, and no upload size limit — `imports/workbook/route.ts:14` reads the whole file into memory via `arrayBuffer()`. No middleware exists. | `api-and-security.md:43` |
| 5.6 | **Dashboard metrics do not state filters, numerator, denominator.** `dashboardSnapshot` (`traceability.ts:78-93`) returns `asOfUtc` and grouped counts only. The non-retired product/test-case counts and `releaseReadinessSnapshot`'s `POLICY_NOT_DEFINED` advisory are correct. | `business-rules-and-validation.md:37` |
| 5.7 | **Zero acceptance-scenario coverage.** 9 tests across 2 files, both pure unit tests (`validation.test.ts`, `controlled-value-catalogues.test.ts`). No DB test harness. None of the 17 scenarios is automated — and `docs/testing-and-acceptance.md:38` makes them the definition of done. §2.1 would have been caught by scenario `testing-and-acceptance.md:12`. | `testing-and-acceptance.md:5-23, 38` |
| 5.8 | **No Prisma migration baseline.** `prisma/migrations/` does not exist; no versioned DDL is committed. | `CLAUDE.md:21`, `architecture.md:5` |
| 5.9 | **Admin RBAC lives in routes, not domain services.** `updateControlledValue` and `updateUserRole` (`admin.ts`) and `createImportRun` (`imports.ts`) contain no `ensureRole`; the QA Lead gate exists only in `controlled-values/route.ts:16`, `users/[id]/role/route.ts:11`, and `imports/workbook/route.ts:8`. Any future caller of these domain functions bypasses authorization entirely. Every other domain service checks internally. | `api-and-security.md:38`, `CLAUDE.md:38` |
| 5.10 | **The documented web interface does not exist** — new to this revision, see below. | `architecture.md:5`, `:9-13`, `:24-31` |

### 5.10 — The documented web interface does not exist

**Missed by both audits.** The 2026-07-29 audit and the first revision of this document were both
scoped to the API, domain services and Prisma schema, and neither checked `docs/` for commitments
about the user interface. That scoping was itself the error: `architecture.md` is an authoritative
document, and it commits to a UI.

`docs/architecture.md:5` — "a Next.js TypeScript application **provides the server-rendered web
interface** and REST/JSON API". The architecture diagram at `:9-13` opens with
`U[Authorized QA user] --> W[Next.js web application] --> A[Route handlers / REST API]`, and the
data-flow section at `:37` begins "A user authenticates and receives a server-side session."

**What exists.** Three files, 43 lines total, none of which consume the API:

```
src/app/page.tsx      9 lines — a static placeholder
src/app/layout.tsx   17 lines — html/body shell + <title>
src/app/globals.css  17 lines
```

`page.tsx` in full renders a heading, "QAMS server is running.", and the text "REST API base path:
/api/v1". There is no components directory, no `"use client"` anywhere in `src/`, no hooks, no
state, no forms, no data fetching, and no route besides `/`. Of the 33 compiled routes, 32 are API
endpoints. React, React DOM and the App Router are installed and wired, so the scaffolding is
present and nothing has been built on it.

`CLAUDE.md:7` acknowledges this openly — "There is no meaningful UI yet — the work lives in the API,
domain services, and Prisma schema" — so this is a known and deliberate sequencing choice, not an
oversight in the code. It is recorded here because an audit of implementation against documentation
has to state that an authoritative document promises a deliverable that is absent, whether or not
the absence is intentional.

**Severity.** Not a defect in anything that exists, and nothing in §2–§4 depends on it. But it is by
some distance the largest gap between `docs/` and the implementation — larger than the import stub
(§5.1) — and it means the system currently has no non-programmatic way for any of the four roles to
do their documented work.

**NOTE — the docs do not specify the interface, and this must be escalated before it is built.**
`docs/` establishes no screens, no field layouts, no navigation model, and no interaction rules
anywhere. `excel-source-map.md:11` explicitly removes the one candidate source: the workbook's Home
sheet is "Not imported; application navigation derives from authorized capabilities." So the only
in-repo basis for a UI is the role/capability matrix (`roles-workflows.md:7-17`), the lifecycle
tables (`:23-49`), and the data model — enough to derive *what a role may do*, but not enough to
determine screens, flows, or presentation.

Per `docs/README.md` § "SSOT operating rule", the gaps below cannot be filled from general practice
and belong to the QA Lead:

1. Screen inventory and navigation — which capabilities in the role matrix become screens, and how a
   user moves between them.
2. Whether the UI is server-rendered (as `architecture.md:5` states) or a client application calling
   `/api/v1`. The wording commits to server-rendered; the API-first implementation to date points
   the other way. This should be settled explicitly rather than by drift.
3. Presentation of the fields the docs deliberately leave undefined — in particular any dashboard
   metric, given `business-rules-and-validation.md:37-38` requires filters/numerator/denominator/
   as-of to be stated before a metric is shown and forbids inventing thresholds (`POLICY_NOT_DEFINED`).
4. How `sanitize displayed rich text as plain text in v1` (`api-and-security.md:42`) is enforced in
   the view layer.
5. Whether evidence references (`api-and-security.md:42`, reference strings only, no binary upload
   in v1) get any UI affordance at all.

**Do not begin UI work by inferring these.** The first step is a documentation change approved by
the QA Lead, per `docs/README.md` § "Versioning and change control".

---

## 6. NOTE — escalate to the QA Lead, do not resolve in code

1. **Catalogue CRUD is gated to QA Lead; RTM link creation to authors.** `catalogue.ts:19, 61, 100, 134, 165, 199, 230, 268` all use `RoleSets.canAdmin`; `traceability.ts:20` uses `RoleSets.canAuthor`. The role matrix at `docs/roles-workflows.md:7-17` has **no row for either capability**. These are conservative and defensible, but they are invented policy and should be written down or corrected.
2. **`POST /auth/login` returns 403 on bad credentials.** `business-rules-and-validation.md:5` defines 403 for unauthorized *actions* and never mentions 401. `requireAuth` (`auth.ts:17, 22`) likewise returns 403 for an absent or invalid session. Consistent, but the authentication-vs-authorization status split is undocumented.
3. **No general validation error code.** `requireNonBlank` throws `ID_INVALID` for non-ID fields — title, objective, block reason, closure rationale (`defects.ts:166`), release-readiness query params. The `ErrorCode` union (`errors.ts:1-14`) has no generic validation member, so the `field` path carries all the meaning. `business-rules-and-validation.md:9-15` lists codes only for identity and reference rules.
4. **`TC-<PRODUCT>-####` is not checked against the product.** `BUSINESS_ID_PATTERNS.testCase` is `/^TC-[A-Za-z0-9]+-\d{4}$/` (`business-ids.ts:8`); the `<PRODUCT>` tag is never compared to the referenced product. The docs do not say what the tag must contain.
5. **Product `status` still has no catalogue.** `data-model.md:16` requires it be "a configured catalogue value", but the workbook seeds only Priority, Severity, and Result (`excel-source-map.md:44`). `dashboardSnapshot` (`traceability.ts:80`) works around this with a case-insensitive string match on `"Retired"`. Unresolvable as written — carried from the previous audit.
6. **`ImportRun.status` and `ImportRowReport.outcome` are unconstrained `String` columns.** No enum pins the documented vocabulary (`SKIPPED_UNCHANGED`, `RECONCILIATION_REQUIRED`, …). Carried from the previous audit.
7. **Tester identity on import.** `data-model.md:5` requires users be referenced by internal ID "never free-text names after import reconciliation", but the Test Execution sheet carries a free-text Tester column and the workbook defines no user accounts (`excel-source-map.md:50`). Carried from the previous audit.
8. **`dotenv` is undeclared.** `prisma/seed.ts:1` imports `dotenv/config`; `dotenv` is in neither `dependencies` nor `devDependencies`. It currently resolves transitively through `node_modules`, so `npm run prisma:seed` works today and will break on a dependency-tree change. Not a policy question — just add it.

---

## 7. Suggested order of work

1. **§2.1 and §2.2** — both are live exposures and both are small. Enumerate writable fields in `createTestCase`; project the user response in `updateUserRole`.
2. **§2.3** — one strict Zod schema per route. This closes §2.1 at the boundary as well, plus §3.3 and §3.7, and converts most of the documented-422-but-actually-500 cases in one pass.
3. **§3.2** — Prisma error mapping in `asErrorResponse`. Roughly fifteen lines; fixes every duplicate-ID and stale-version race at once, and is a prerequisite for a clean §3.1.
4. **§3.1** — move version checks into the `WHERE` clause across the domain services. Mechanical, but touches every mutation, so land it after the error mapping.
5. **§5.7** — the acceptance suite. It protects everything above, and scenario `testing-and-acceptance.md:12` would have caught §2.1 on the day it was written.
6. **§3.4, §3.5, §3.6, §4.2** — self-contained corrections.
7. **§5.1** — the workbook import, the largest remaining feature. A Relay plan already exists at `.relay/runs/2026-07-29-workbook-import/plan.md`.
8. **§5.9, §5.3, §5.4, §5.5, §5.6, §5.8** — contract and operational completeness. §5.4 needs the QA Lead input in §6 first.
9. **§6 and §5.2** — escalations. None of these may be resolved by implementation choice.
10. **§5.10** — the web interface. Sequenced last deliberately: it is the largest gap, but it is
    blocked on a QA Lead decision (see the NOTE in §5.10) and nothing above depends on it. It should
    not start until the screen inventory and the server-rendered-vs-client question are documented
    and approved.
