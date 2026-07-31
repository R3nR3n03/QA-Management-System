# QAMS Production Readiness Audit

**Date:** 2026-07-31
**Repository state:** `082777f` on `fix/request-boundary-validation`; working tree also holds an
uncommitted UI prototype on `prototype/ui-vertical-slice`.
**Scope:** operational readiness for a real deployment — security posture, data integrity under
concurrency, observability, supply chain, deployment, and performance at scale.
**Companion document:** `IMPLEMENTATION-AUDIT-2026-07-31.md` covers conformance of the code to
`docs/`. This document deliberately does **not** repeat it; where a finding here overlaps, it is
cross-referenced rather than restated.

---

## Verdict

**Original verdict (2026-07-31): not deployable to a production environment in its current
state.** All nine blockers have since been closed — see the table below. The verdict now is
**no longer blocked, but not yet proven in production**: seven HIGH findings remain, the CI
pipeline has never executed, and nothing here has run behind a real proxy or over HTTPS.

The domain layer was already well built — lifecycle rules, RBAC, audit emission and validation are
coherent and well covered by unit tests. What was missing was nearly everything *around* it: no
deployment pipeline, no runtime observability, no rate limiting, no security headers, no health
endpoint, a dependency with four unfixed high-severity CVEs sitting directly in the file-upload
path, and a database with no non-unique indexes. Of those, only the health endpoint (C2) and the
indexes (C4) are still open, and both are HIGH rather than blocking.

None of it was a criticism of the sequencing — the project built the domain first, on purpose.

### Severity summary

| | Count | Open findings | Meaning |
|---|---|---|---|
| **BLOCKER** | 0 *(was 9)* | — | Must be resolved before any deployment reachable by real users |
| **HIGH** | 5 | B3, C2, C3, D2, E1 | Resolve before or immediately alongside first deployment |
| **MEDIUM** | 9 | B4, B5, B6, C4, D3, D4, D5, E2, E3 | Will cause operational pain; schedule deliberately |
| **MISSING** | 5 | F1–F5 | Documented or implied functionality that does not exist yet |

Thirty findings in total, **all nine blockers now resolved** — see the marked sections:

| Resolved | What | Landed |
|---|---|---|
| **C1** | Structured request logging at both boundaries | `0e61724` |
| **A1** | `xlsx` migrated off the frozen npm copy to the vendor build | `main`, 2026-07-31 |
| **A2** | Workbook upload size limit, checked before the body is buffered | `main`, 2026-07-31 |
| **A4** | `passwordHash` no longer returned — projection, not deletion | `main`, 2026-07-31 |
| **A3** | Rate limiting on both login doors and on import, failures-only client dimension | `c4e9993` |
| **A5** | Six security headers; nonced CSP via middleware | `c4e9993` |
| **A7** | `SameSite=Strict`, cookie options centralised | `c4e9993` |
| **D1** | CI workflow mirroring the gates; `output: "standalone"` | `c4e9993` |
| **A6** | Sessions revocable via `User.sessionsValidFrom` | `9941c9e` |

With A4 closed, **no CRITICAL from `IMPLEMENTATION-AUDIT-2026-07-31.md` remains open** —
§2.1, §2.2 and §2.3 are all fixed and verified against a running server.

C1 earned its keep within the hour: it surfaced a `PrismaClientValidationError` that had
made **`GET /dashboard` return 500 on every request since it was written** (fixed in `a802a6a`).
That defect was invisible precisely because errors were being swallowed — which is the argument
for **F3** in one line.

**What closing them did not buy.** D1 shipped a CI workflow that **has never executed** — there is
no git remote and `gh` is not installed — so every fix above is still protected only by somebody
running the gates by hand. A3's limiter is one process's memory. A5's CSP was proven by
inspecting served HTML, never in a browser. A7's `allowedOrigins` and HSTS need a real deployment.
A6 gives per-user, not per-device, revocation. Each is recorded in its own section; none is a
reason to reopen a blocker, and all of them are reasons not to call this done.

### How each finding was established

Every finding is marked with how it was checked, because that materially affects how much you
should trust it:

- **VERIFIED** — I executed something and observed the result. Command output is quoted.
- **CODE-READ** — established by reading the source; no runtime confirmation.
- **INFERRED** — reasoning from the two above; explicitly flagged where confidence is lower.

---

## A. Security blockers

### A1. ~~BLOCKER~~ **RESOLVED 2026-07-31** · `xlsx` carried four unfixed high-severity CVEs

> **Fixed.** Migrated from the frozen npm copy (0.18.5) to the vendor-distributed
> build, `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` — 0.20.3 is the latest
> the CDN publishes (0.21.x returns 404). `npm audit --omit=dev` no longer lists
> `xlsx` at all. The API is source-compatible; a write/read round trip was verified.
>
> **Still outstanding, and not this finding:** the audit now reports `next`, `postcss`
> and `sharp`. All three are transitive framework dependencies and all are addressed
> by the Next upgrade in **D3** — `npm audit fix --force` proposes downgrading Next to
> 9.3.3, which is not a fix. Note the project uses no `next/image`, so `sharp` is
> likely never loaded at runtime; that is worth confirming rather than assuming.

The original finding follows.



**VERIFIED** — `npm audit --omit=dev`:

```
xlsx  *
Severity: high
Prototype Pollution in sheetJS - GHSA-4r6h-8v6p-xvw6
SheetJS Regular Expression Denial of Service (ReDoS) - GHSA-5pgg-2g8v-p4x9
No fix available
4 high severity vulnerabilities
```

**Why this one matters more than a typical audit finding.** This is not a transitive dependency in
a build tool. `src/domain/imports.ts:23` calls `XLSX.read(rawBuffer, { type: "buffer" })` on a file
uploaded through `POST /imports/workbook`. That is attacker-controlled input reaching a parser with
a known prototype-pollution and a known ReDoS advisory, and **npm reports no fix available**.

The reason there is no fix is that SheetJS stopped publishing to the npm registry; the `xlsx` package
on npm is frozen at 0.18.5 and unmaintained. The maintained builds are distributed from the vendor's
own CDN.

**Fix.** Move to the vendor-distributed package:

```bash
npm remove xlsx
npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
```

Pin the exact version and record the provenance in `package.json`, since this bypasses the registry.
Then re-run `npm audit`. **Combine with A2** — a parser hardened against ReDoS still should not be
handed an unbounded input.

Mitigating context: the endpoint is QA-Lead-only (`imports/workbook/route.ts:8`) and authenticated,
so this is not anonymously reachable. That reduces the blast radius; it does not remove the finding,
because a compromised or malicious QA Lead account is exactly the threat model an audited QA system
exists to constrain.

### A2. ~~BLOCKER~~ **RESOLVED 2026-07-31** · Workbook upload had no size limit

> **Fixed.** `src/lib/upload-limits.ts`, wired into the route in two places:
> `Content-Length` is checked **before** `request.formData()` — which is the point,
> since `formData()` buffers the whole multipart payload into memory — and `file.size`
> is checked after, because a chunked request sends no `Content-Length` and a supplied
> one need not be honest.
>
> The limit is `MAX_UPLOAD_BYTES`, defaulting to 10 MB. That number is **not policy**:
> `api-and-security.md:43` puts the exact limits outside the knowledge base, so it is
> a deployment default awaiting QA Lead confirmation. An unusable value falls back to
> the default rather than removing the limit — a typo can fail to narrow the gate, it
> can never open it.
>
> Verified live: a 12 MB payload returns `422 ID_INVALID` naming the limit, a valid
> 26 KB workbook still returns `201`, and a QA Engineer still gets `403` before any
> size logic runs.
>
> **Honest scope:** this stops the *buffering and parsing* of an oversized body. It
> does not stop a client transmitting the bytes — they still traverse the socket
> before the handler runs. Rejecting at the transfer layer needs a limit at the
> reverse proxy or platform, which belongs with **D1**.

The original finding follows.



**CODE-READ** — `src/app/api/v1/imports/workbook/route.ts:16`:

```ts
const bytes = await file.arrayBuffer();
```

The entire uploaded file is read into process memory before any check. There is no
`maxFileSize`, no streaming, and no Next body-size configuration anywhere. A single large upload can
exhaust the Node heap and take the process down; combined with A1's ReDoS advisory, a crafted file
can hold a worker indefinitely.

**Fix.** Reject on `file.size` before reading, at a limit the QA Lead sets (the workbook is a seed
artefact; single-digit MB is generous). Return `422 ID_INVALID` with field `file`, consistent with
the error contract.

### A3. BLOCKER · No rate limiting anywhere

**VERIFIED** — no `middleware.ts` exists (checked `src/middleware.ts` and `middleware.ts`); no
rate-limit code appears in `src/`.

`docs/api-and-security.md:43` requires it explicitly: *"Rate limit authentication and import
endpoints."* Nothing implements it. Consequences:

- `POST /api/v1/auth/login` accepts unlimited credential attempts. There is no lockout, no backoff,
  and no failed-attempt counter anywhere in the schema.
- The UI prototype adds a **second** unthrottled entry point to the same credential check via the
  `signIn` server action (`src/app/login/actions.ts`), noted in its own source comment.
- `POST /imports/workbook` compounds A1 and A2.

**Fix.** Middleware-level limiting keyed on IP for login and on user for imports. Note the
constraint: `src/lib/session.ts` uses Node `crypto` (`createHmac`, `timingSafeEqual`), which does
not run on the Edge runtime — so middleware must be configured for the Node runtime, or the limiter
must live in the route/action layer instead. **This is a real design decision, not a drop-in
library.**

### A4. ~~BLOCKER~~ **RESOLVED 2026-07-31** · `passwordHash` was returned by the API

> **Fixed.** `updateUserRole` reads and returns through `USER_RESPONSE_SELECT` —
> `id`, `email`, `displayName`, `role`, `active`, `version` — so the hash never leaves
> the database and cannot be present on the return type. Verified live: exactly those
> six keys, no scrypt hash in the body. Every other path a `User` could reach a
> response was checked and already projects; this was the only one.
>
> Detail in `IMPLEMENTATION-AUDIT-2026-07-31.md` §2.2.

The original finding follows.



**VERIFIED at runtime** against a live server. `PATCH /api/v1/users/{id}/role` returned:

```
keys returned: id, email, displayName, passwordHash, role, active, version, createdAt, createdBy, updatedAt, updatedBy
passwordHash present: YES
```

Directly violates `docs/data-model.md:35` — *"passwordHash is never returned by the API or written
to audit logs."* The audit half is honoured; the response half is not.

This is `IMPLEMENTATION-AUDIT-2026-07-31.md` §2.2, still open. It is a two-line fix — return an
explicit projection from `updateUserRole` (`src/domain/admin.ts:51-54`) instead of the full Prisma
record. `src/domain/auth.ts` already demonstrates the correct pattern.

### A5. BLOCKER · No security headers

**VERIFIED** — `next.config.ts` in full:

```ts
const nextConfig: NextConfig = { reactStrictMode: true };
```

No `headers()`, no CSP, no HSTS, no `X-Frame-Options`/`frame-ancestors`, no
`X-Content-Type-Options`, no `Referrer-Policy`, no `Permissions-Policy`.

Once a UI exists (§F5) this becomes the difference between a contained XSS and a session takeover —
particularly because the session cookie is the only auth credential and there is no server-side
revocation (A6). `docs/api-and-security.md:42` requires rich text be rendered as plain text in v1,
which is the right instinct, but headers are the backstop for when that slips.

**Fix.** A `headers()` block in `next.config.ts`. CSP will need care with Next's inline
bootstrap scripts — plan for `strict-dynamic` with nonces rather than a naive `default-src 'self'`.

### A6. ~~BLOCKER~~ **RESOLVED 2026-07-31** · Sessions could not be revoked

> **Fixed.** The token now carries an issue time, checked against a new nullable
> `User.sessionsValidFrom`. Signing out stamps that column, so every token issued before
> that instant is refused on its next request, on every device. Both logout doors revoke,
> and both stay idempotent — logging out must never fail.
>
> **A column, not a `Session` entity.** `data-model.md` enumerates four entities and
> `Session` is not one; inventing it needs QA Lead approval. **So this does NOT deliver
> per-device sign-out or a register of who was signed in when** — both genuinely need the
> table, and that question stays open.
>
> Every existing cookie became invalid on deploy (3-part → 4-part token): everyone is signed
> out once, deliberately, because a 3-part token carries no issue time and cannot be checked.
>
> Verified live: replaying a cookie after logout returns **403** where it previously returned
> 200 until expiry; re-login still works; deactivation still takes effect immediately.

The original finding follows.



**CODE-READ** — `src/lib/session.ts` is a stateless HMAC: `userId.expiresAt.signature`, verified by
recomputing the signature. There is no session table, no token ID, no revocation list.

Practical consequences:

- **Signing out does not invalidate anything.** `POST /auth/logout` deletes the client's cookie
  (`auth/logout/route.ts`); a copy of that cookie value keeps working for the remainder of its 12-hour
  TTL.
- A leaked cookie cannot be killed. The only remedy is rotating `SESSION_SECRET`, which signs out
  every user simultaneously.
- Deactivating a compromised account *does* take effect immediately — `requireAuth` re-reads the user
  and checks `active` on every request (`src/lib/auth.ts:20-23`). That is a genuinely good decision
  and it partially compensates. Role changes likewise apply immediately.

**Fix.** Either a `Session` table (id, userId, issuedAt, expiresAt, revokedAt) checked in
`requireAuth`, or shorten the TTL substantially and add refresh. The first is the honest answer for
an audited system: `docs/business-rules-and-validation.md:50` requires audit events for security-
relevant actions, and "who was signed in when" is currently unanswerable.

### A7. BLOCKER · No CSRF defence beyond `SameSite=Lax`

**CODE-READ** — `auth/login/route.ts` sets `sameSite: "lax"`, `httpOnly: true`,
`secure: NODE_ENV === "production"`.

`SameSite=Lax` blocks cross-site POST with cookies in current browsers, which covers the mutating
REST endpoints in practice. It is a single layer, and it does **not** cover top-level GET navigation.
No CSRF token exists.

Raised as a BLOCKER specifically because the UI prototype introduces **server actions**, which post to
the same origin and are a well-known CSRF target class. Next mitigates this with an Origin check,
but that mitigation should be verified for your deployment topology (proxies rewriting `Origin`/`Host`
break it) rather than assumed.

**Fix.** Confirm `experimental.serverActions.allowedOrigins` is correct for the deployed hostname,
and consider `SameSite=Strict` for this application — it is an internal tool, so the usability cost
of strict mode is low.

---

## B. Data integrity and correctness

### B1. ~~HIGH~~ **RESOLVED 2026-07-31** · Optimistic concurrency was not atomic

> **Fixed in `c4d7421`.** The expected version now goes into the UPDATE's `WHERE` across
> all 16 versioned mutations, so the database performs the compare as part of the write.
> `P2025` is translated to `409 VERSION_CONFLICT` by `src/lib/optimistic-lock.ts` —
> scoped to the versioned write rather than installed globally, because `P2025` on a
> nested relation is a `REFERENCE_NOT_FOUND`, not a conflict.
>
> `ensureVersion` is kept as the fast path and is still the ONLY thing that catches an
> **omitted** version: Prisma silently ignores `where: { version: undefined }`, which
> would have turned a missing version into an unconditional write.
>
> Verified with 6 concurrent writers x 20 rounds against a production build: 100 conflicts
> raised, exactly one winner per round, zero lost updates. **And verified that the check can
> fail** — reverting one where-clause produced lost updates in 19 of 20 rounds, with all six
> writers succeeding and five changes discarded each time.
>
> **B2 remains open**: duplicate business IDs (`P2002`) still surface as 500s.

The original finding follows.



**CODE-READ**, and the single most consequential correctness defect still open.

Every mutation follows this shape (representative: `src/domain/catalogue.ts:65-79`):

```ts
const current = await prisma.product.findUnique({ where: { id } });  // outside the transaction
ensureVersion(current.version, input.version);                        // check
return prisma.$transaction(async (tx) => {
  const updated = await tx.product.update({
    where: { id },                                                    // version NOT in the WHERE
    data: { …, version: { increment: 1 } }
  });
```

The read happens outside the transaction and the version never reaches the `WHERE` clause. Two
concurrent editors both read `version: 1`, both pass `ensureVersion`, and both write. The second
silently overwrites the first, and the row lands at `version: 3`. **No `VERSION_CONFLICT` is raised.**

The whole point of the `version` column is to prevent this, and on a shared test repository — the
normal working pattern for a QA team — it will happen.

**Fix.** `where: { id, version: expected }`, treating Prisma `P2025` as `409 VERSION_CONFLICT`.
Mechanical, but it touches every mutation in `catalogue.ts`, `test-cases.ts`, `executions.ts`,
`defects.ts`, `admin.ts`. Do B2 first so the error mapping exists.

(`IMPLEMENTATION-AUDIT-2026-07-31.md` §3.1.)

### B2. ~~HIGH~~ **RESOLVED 2026-07-31** · Database constraint violations surfaced as 500

> **Fixed.** `src/lib/prisma-errors.ts` maps `P2002` to 409 `ID_DUPLICATE` (with the
> column as `field`), `P2003` to 422 `REFERENCE_NOT_FOUND`, and `P2025` to 404 — applied
> at both the API boundary and in `runAction`, so a constraint reads the same through a
> screen as through the API.
>
> `P2025` is **not** mapped to `VERSION_CONFLICT`: versioned writes convert theirs in
> `withVersionCheck` (B1) before reaching here, so one arriving at this point is a
> different failure. Messages are fixed strings — Prisma embeds the failing query and its
> data, which `api-and-security.md:33` bars from a response. The original still reaches the log.
>
> Verified live with 12 rounds x 6 concurrent creates of one business ID: 60 conflicts, of
> which **55 came from the database constraint and every one of those was a 500 before**.
> Zero 500s, no SQL detail in any body.

The original finding follows.



**CODE-READ** — `src/lib/errors.ts:44-53` has no `PrismaClientKnownRequestError` branch, so every
Prisma error becomes `500 INTERNAL_ERROR`.

`docs/architecture.md:46` deliberately designs the database as the second line of defence
(*"Enforce unique business IDs and foreign keys in PostgreSQL **in addition to** service
validation"*). The constraints fire correctly; the mapping throws the information away. A concurrent
duplicate business ID returns 500 where `docs/business-rules-and-validation.md:5` documents 409.

**Fix.** ~15 lines in `asErrorResponse`: `P2002` → `409 ID_DUPLICATE` (field from `err.meta.target`),
`P2025` → `409 VERSION_CONFLICT`, `P2003` → `422 REFERENCE_NOT_FOUND`. Prerequisite for a clean B1.

### B3. HIGH · The RTM uniqueness constraint does not work for the common case

**CODE-READ** — `prisma/schema.prisma:277`: `@@unique([requirementId, testCaseId, defectId])` with
`defectId String?`.

In PostgreSQL, `NULL` values are never equal, so this constraint **does not deduplicate any trace
link without a defect** — and `docs/business-rules-and-validation.md:36` explicitly contemplates
those. Unlimited identical `(requirement, testCase, null)` rows are insertable, and
`createRtmLink` has no duplicate pre-check of its own.

**Fix.** A partial unique index for the `defectId IS NULL` case, plus an explicit service-level check.

### B4. MEDIUM · Reopen reasons are demanded and discarded

**CODE-READ** — `src/domain/defects.ts:172-174` requires `reopenReason` to be non-blank, then never
persists it: there is no column on `Defect`, and the audit event at `:189-196` records only
`{ before: { status }, after: { status } }`.

`docs/roles-workflows.md:49` requires the reason be *recorded*. Nothing in the system can answer why
a defect was reopened — in a tool whose purpose is traceability. The same audit event omits
`resolutionSummary`, `closureRationale` and `retestEvidenceRef`; those at least reach their columns.

### B5. MEDIUM · No database backup, retention, or restore procedure

**Not established by the knowledge base, and correctly escalated there.**
`docs/architecture.md:49` says retention *"is not defined by this knowledge base and must be escalated
to the QA Lead."*

For production that escalation must actually be resolved: an audit log that is append-only in the
application but has no backup is not durable. There is also **no tested restore** — a backup nobody
has restored is a hypothesis.

### B6. MEDIUM · Audit log grows without bound and has no index

**CODE-READ** — `AuditEvent` (`prisma/schema.prisma:310-319`) has no `@@index` on `entityId`,
`entityType`, `actorId`, or `occurredAt`, and no partitioning or archival strategy.

Every create, update and transition writes a row. On a real QA programme this becomes the largest
table, and the queries you will actually want — "everything that happened to `TC-…-0042`", "what did
this actor do last week" — are unindexed sequential scans. See also C4.

---

## C. Observability and operations

### C1. ~~BLOCKER~~ **RESOLVED 2026-07-31** · No structured logging — incidents were not diagnosable

> **Fixed in `0e61724`.** `src/lib/logging.ts` emits one JSON line per request from
> `withRoute` and `runAction`, carrying every field `architecture.md:47` names, with
> the stack retained on 5xx and credential-bearing keys redacted. Verified live.
>
> It immediately paid for itself: the first 500 it caught was a
> `PrismaClientValidationError` that had made `GET /dashboard` fail on **every**
> request since it was written — fixed in `a802a6a`.
>
> **C3 (error tracking / metrics / alerting) remains open** and was blocked on this.

The original finding follows.



**VERIFIED** — `src/` contains no logger and not a single `console.*` call.

`docs/architecture.md:47` requires *"structured logs with request ID, actor ID, action, outcome, and
error code."* None exists. Concretely:

- `asErrorResponse` (`src/lib/errors.ts:44`) **swallows the caught error entirely** and replaces it
  with `"Unexpected error."`. Every 500 in this document — B1, B2, and any future one — is invisible.
  You cannot find out what happened after the fact.
- `runAction` in the UI prototype does the same, and says so in its own comment.
- A `requestId` is generated and returned to the client in every error body, but it is **never
  written anywhere**. The UI prototype shows it to users as a support reference. Today that reference
  correlates with nothing.

**Fix.** Log at the two boundaries — `withRoute` (`src/lib/route.ts:17-19`) and `runAction` — one
structured line per request outcome, plus the caught error's detail on the 500 path. The audit event
records *business* history; this records *operational* history, and they are not substitutes. Nothing
downstream (metrics, alerting, tracing) can be built until this exists.

### C2. HIGH · No health or readiness endpoint

**VERIFIED** — no route matching `health` or `ready` under `src/app`.

Every deployment platform and load balancer needs one. Without it a container that has lost its
database connection continues receiving traffic. Needs both liveness (process up) and readiness
(database reachable, migrations applied).

### C3. HIGH · No error tracking, metrics, or alerting

**INFERRED** from the absence of C1 and of any dependency providing it. No Sentry/OpenTelemetry/
Prometheus integration exists. Nobody is paged when the system starts failing; the first signal will
be a user complaint. Blocked on C1.

### C4. MEDIUM · No non-unique indexes anywhere in the schema

**VERIFIED** — every index in `prisma/schema.prisma` is a `@unique` or `@@unique`; there is not one
`@@index`.

PostgreSQL does **not** automatically index foreign keys. So every FK column is unindexed:
`Module.productId`, `Feature.moduleId`, `Requirement.featureId`, all four hierarchy columns on
`TestCase`, `TestStep.testCaseId`, `TestExecution.testCaseId`, `TestExecution.testerId`,
`ExecutionHistory.executionId`, `Defect.testCaseId`, `RequirementTraceLink.*`,
`ImportRowReport.importRunId`, and every column on `AuditEvent`.

Combined with E1 (no pagination), the dashboard and list endpoints degrade from "fine on demo data"
to "unusable" somewhere in the low tens of thousands of rows — and `listExecutionsForTester` in the
UI prototype filters on the unindexed `testerId`.

**Fix.** Add `@@index` for every FK and for the audit query patterns, in one migration. Cheap, and
much cheaper now than after the table is large.

---

## D. Deployment and supply chain

### D1. BLOCKER · There is no deployment pipeline of any kind

**VERIFIED** — no `Dockerfile`, no `.github/`, no `.gitlab-ci.yml`, no `vercel.json`, no `Procfile`,
no CI config of any description. Also: **no git remote**, so nothing is pushed anywhere and no PR
has ever been opened.

The four gates (`build`, `lint`, `test`, `typecheck`) are green and are declared in
`relay.config.json`, but **nothing runs them automatically**. They have only ever run because an
agent or a person invoked them by hand. There is no branch protection, no required check, and no
artefact.

**Fix, in order:** create a remote → CI running the four gates on push → a build artefact
(container or Next standalone output) → a deploy step. Until then "production" has no meaning for
this project.

### D2. HIGH · Runtime version is unpinned

**VERIFIED** — `package.json` declares **no** `engines` field and no `packageManager`; there is no
`.nvmrc`. Local Node is v20.19.6.

Nothing stops CI or a host from building on a different major version. Prisma 7, Next 15 and the
crypto APIs in `src/lib/session.ts` all have version-sensitive behaviour.

**Fix.** `"engines": { "node": ">=20.19 <21" }`, a `.nvmrc`, and `packageManager` pinned to the npm
version you use. `package-lock.json` is committed, which is correct and already handles the
dependency tree itself.

### D3. MEDIUM · Dependencies are a major version behind

**VERIFIED** — `npm outdated`: `next` 15.5.22 → 16.2.12, `typescript` 6.0.3 → 7.0.2,
`eslint` 9.39.5 → 10.8.0.

Note `eslint-config-next@16` is *already installed* against `next@15` — a version skew that is
currently benign only because the lint script was migrated off the deprecated `next lint` earlier
today. Upgrading Next to 16 is a prerequisite for staying on supported security patches, and should
be a deliberate, tested step rather than a surprise.

### D4. MEDIUM · Secrets handling is undocumented and unrotatable

**VERIFIED** — `.env` is correctly gitignored (`.gitignore:9-11`) and only `.env.example` is tracked;
no secret is committed. Good.

Gaps: `.env.example` documents only `DATABASE_URL` and `SESSION_SECRET`, omitting
`SEED_QA_LEAD_PASSWORD` and `SEED_QA_LEAD_EMAIL` even though `CLAUDE.md:22` says the seed requires
the former. There is no documented rotation procedure for `SESSION_SECRET` (rotating it signs out
every user — see A6), no minimum-entropy requirement, and no secret manager integration.

`docs/api-and-security.md:41` requires secrets live in deployment-managed environment variables;
that is satisfied in principle and undocumented in practice.

### D5. MEDIUM · Production migration strategy is unstated

**VERIFIED** — `prisma/migrations/20260731040824_init` now exists and is applied locally
(`prisma migrate status`: *"Database schema is up to date!"*). That closes the baseline gap.

But `package.json` only provides `prisma:migrate` → `prisma migrate dev`, which is a **development**
command that can prompt, reset, and generate. Production requires `prisma migrate deploy`. There is
no such script, no documented rollback, and no plan for zero-downtime schema changes.

---

## E. Performance and scale

### E1. HIGH · Every collection endpoint is unbounded

**CODE-READ** — `listProducts`, `listModules`, `listFeatures`, `listRequirements`, `listTestCases`,
`listExecutions`, `listDefects`, `listRtmLinks`, `listControlledValues` are all bare `findMany` with
a fixed `orderBy` and no `take`/`skip`. `listTestCases` additionally `include`s every step of every
case.

`docs/api-and-security.md:5` requires *"server-side pagination, filtering, and sorting"*. None
exists; no query parameter is read anywhere.

This is both a performance and an availability problem: a single request for `/test-cases` on a
mature repository loads every test case and every step into memory, serialises it to JSON, and ships
it. With C4 (no indexes) it is a sequential scan as well.

**NOTE — escalate first.** `docs/` never enumerates which fields are the "documented fields" for
filtering and sorting, so the contract cannot be implemented as written without a QA Lead decision.
(`IMPLEMENTATION-AUDIT-2026-07-31.md` §5.4 and §6.)

### E2. MEDIUM · Password hashing parameters are below current guidance

**CODE-READ** — `src/lib/password.ts:7` calls `scryptSync(password, salt, 64)` with Node's defaults:
`N=16384 (2^14)`, `r=8`, `p=1`.

The construction is otherwise sound — 16-byte random salt per user, `timingSafeEqual` comparison,
length check before comparison. But OWASP's current scrypt guidance is `N=2^17`, and the cost
parameter is not configurable, so it cannot be raised as hardware improves without a code change and
a rehash strategy.

**Fix.** Make the parameters explicit and configurable, store them alongside the hash (the
`salt:hash` format already has room for a third field), and rehash on successful login when the
stored parameters are below target. Not urgent; awkward to retrofit later.

### E3. MEDIUM · No connection pool configuration

**CODE-READ** — `src/lib/db.ts:8` constructs `new PrismaPg(process.env.DATABASE_URL)` with no pool
options. Defaults may be fine for a small internal tool, but they are undeclared, untested, and
invisible — and serverless deployment in particular needs deliberate pool sizing.

The singleton pattern guards against dev hot-reload exhaustion correctly. Note the adapter is
constructed at module load regardless of whether the cached global client is reused — harmless, but
untidy.

---

## F. Missing implementation

### F1. MISSING · Workbook import is a stub — the primary documented data path

`src/domain/imports.ts` is 52 lines: it checks 13 sheet names exist and writes one `ImportRun` row
with `status: "VALIDATED"`. Absent: header validation, row parsing for all 11 imported sheets,
dependency-ordered atomic commit, idempotency (`SKIPPED_UNCHANGED`), reconciliation detection
(`RECONCILIATION_REQUIRED`), rejection handling (`ROW_INCOMPLETE`), row-level reporting
(`ImportRowReport` is never written), `sourceFileHash`, `completedAt`, and dashboard recalculation.

Four acceptance scenarios in `docs/testing-and-acceptance.md:8-10` cover it. An implementation exists
on the unmerged `feature/workbook-import` branch (`2cab7cc`) and has not been audited.

### F2. MISSING · Import reconciliation operation

`docs/api-and-security.md:47` promises *"a documented follow-up operation"* that is documented
nowhere. `RECONCILIATION-POLICY-AMENDMENT-DRAFT.md` proposes it in full and is awaiting QA Lead
approval. **Two of its eight open decisions are conflicts between authoritative documents** and must
be settled regardless of what else is accepted.

### F3. MISSING · The acceptance suite

**VERIFIED** — 14 test files, 167 tests, **all pure unit tests**. There is no API test, no
integration test, and no end-to-end test.

`docs/testing-and-acceptance.md:38` makes the 17 acceptance scenarios the definition of done. **Zero
are automated.** A database is now available locally for the first time, so this is finally possible
— and several scenarios were confirmed by hand today (see §G), which proves they are reachable.

This is the finding that most directly threatens everything else in this document: without it, every
fix listed here is verified once, manually, and then unprotected.

### F4. MISSING · `GET /users/{id}/role`

`docs/api-and-security.md:16` lists `GET/PATCH`. Only `PATCH` is implemented.

### F5. MISSING · The web interface

`docs/architecture.md:5` commits to *"the server-rendered web interface"*, and the diagram at `:9-13`
opens with an authorised QA user reaching it. What exists in `main` is a 9-line placeholder page.

A working vertical slice (sign in → work queue → start → finalize, with a capability-derived nav, an
error-copy translation layer for all 13 error codes, and a session gate) exists **uncommitted** on
`prototype/ui-vertical-slice`. It is a prototype: not reviewed, not covered by the acceptance suite,
and dependent on decisions `docs/` has not made — screen inventory, whether the UI is server-rendered
or a client app, and dashboard presentation. See `IMPLEMENTATION-AUDIT-2026-07-31.md` §5.10 for the
five questions that need a QA Lead answer before it is built out.

---

## G. What is already production-grade

Stated plainly, because an audit that lists only problems misrepresents the codebase.

- **The domain layer is well designed.** RBAC, lifecycle transitions, hierarchy validation, controlled
  values and audit emission all live in one place and are enforced regardless of caller. Building the
  UI prototype required no rule to be reimplemented — the strongest available evidence that the
  boundary is in the right place.
- **The error contract is coherent.** Stable codes, a consistent shape, `requestId` in every body.
- **Request validation is now real.** All 24 routes parse through strict Zod schemas; `parseJson` is
  deleted, so the hole cannot be reintroduced silently.
- **Auth fundamentals are right.** Role resolved server-side from the database on every request;
  clients never submit a role; deactivation takes effect immediately; scrypt with per-user salt and
  constant-time comparison; `httpOnly` + `secure` in production.
- **The audit trail works.** Verified against a live database: 19 events across 11 action types from
  a single demo run, written inside the same transaction as the mutation.
- **Governance discipline is unusually strong.** Where policy is undefined the code returns
  `POLICY_NOT_DEFINED` rather than inventing a threshold. Undocumented decisions are escalated in
  writing rather than guessed. That is rarer than it should be and worth protecting.
- **Several documented behaviours were verified end-to-end today** against a live server: the
  lifecycle-bypass fix (422 with field `lifecycleState`), null/array request bodies (422 not 500),
  finalize with an omitted or non-enum result (422 not 500), a missing `version` still returning
  409 `VERSION_CONFLICT`, Fail-without-defect and Blocked-without-reason both 422.

---

## H. Suggested sequence

Ordered by dependency, not by severity alone.

**Phase 1 — before anything is deployed anywhere**

1. **C1, structured logging.** Everything operational is blocked on it, and every 500 is currently
   invisible.
2. **A4, the `passwordHash` leak.** Two lines; the pattern already exists in `src/domain/auth.ts`.
3. **A1 + A2, the `xlsx` supply chain and the upload limit.** Together, since they share a path.
4. **D1, CI running the four gates.** Until this exists, every other fix is protected only by
   somebody remembering to run the gates.
5. **D2, pin the runtime.**

**Phase 2 — correctness under real use**

6. **B2, Prisma error mapping** (prerequisite for B1).
7. **B1, atomic version checks.** Mechanical, touches every mutation, prevents silent data loss.
8. **C4, indexes.** One migration; far cheaper now than later.
9. **F3, the acceptance suite.** Now possible for the first time. Protects phases 1–2.

**Phase 3 — deployable posture**

10. **A3, rate limiting** (note the Edge-runtime constraint in A3).
11. **A5, security headers**; **A7, CSRF verification**.
12. **C2, health endpoint**; **C3, error tracking**.
13. **A6, session revocation.**
14. **D5, production migration path**; **B5, backups with a tested restore.**

**Phase 4 — feature completeness**

15. **F1, the workbook import** (audit `feature/workbook-import` first).
16. **E1, pagination** — needs the QA Lead decision in E1's note first.
17. **F5, the web interface** — needs the five decisions in §5.10 of the implementation audit.
18. **B4, B3, F4, E2, E3, D3, D4.**

**Standing escalations to the QA Lead** — none of these may be resolved by implementation choice:
the reconciliation policy (F2), the "documented fields" for filtering (E1), backup retention (B5),
product Status catalogue, tester identity on import, and the five UI questions.

---

*Prepared 2026-07-31. Companion to `IMPLEMENTATION-AUDIT-2026-07-31.md`. This document assesses
operational readiness only; it establishes no policy and amends no document in `docs/`.*
