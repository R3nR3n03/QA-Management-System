# Audit — `feature/workbook-import` (commit `2cab7cc`)

**Date:** 2026-07-31
**Subject:** the unmerged seed-import implementation — 1,712 lines across
`src/domain/imports.ts` (1,194), `src/domain/import-parsing.ts` (265) and
`src/domain/import-parsing.test.ts` (253).
**Base:** branched from `main` at `845dcbf`; `main` is now `0e61724`, nine commits ahead.
**Purpose:** decide whether this should be rebased and merged. **It has not been merged, and this
document recommends it is not merged until W1 is answered by the QA Lead.**

---

## Verdict

**The engineering is good. One policy decision blocks the merge, and it is not the author's to
make.**

This is a serious, careful implementation. It closes the largest documented gap in the project
(`IMPLEMENTATION-AUDIT-2026-07-31.md` §5.1) and does nearly everything `docs/excel-source-map.md`
§ "Import order and behavior" asks for. The parsing layer is cleanly separated, pure, and well
tested. Error reporting is per-row with stable codes. Batches are genuinely atomic.

Two things stop it being a straight merge: it silently decides a policy question the knowledge base
explicitly leaves open (W1), and it contradicts a documented architectural rule for a defensible
engineering reason (W2). Both need a decision recorded before this lands.

| | Count | Findings |
|---|---|---|
| **BLOCKER** | 1 | W1 |
| **HIGH** | 2 | W2, W3 |
| **MEDIUM** | 3 | W4, W5, W6 |
| **NOTE** | 3 | W7, W8, W9 |

### Verification performed

| Check | Result |
|---|---|
| `npx vitest run` on the branch, in an isolated worktree | **PASS** — 27 tests / 2 files |
| `npx tsc --noEmit` on the branch | **PASS** — clean |
| Rebase conflict surface vs. current `main` | The stack made **zero** commits to either file this branch changes |
| Full code read | `import-parsing.ts` in full; `imports.ts` orchestration, settings, products, modules, test cases, executions, tester resolution, entry point |

**Not verified:** this has never been run against a real workbook or a live database. There is no
`.xlsx` fixture in the repository and no integration test. Everything below is code-read plus the
branch's own unit tests.

---

## W1. BLOCKER · Imported test cases are created **Approved**, and the docs forbid inventing that

`src/domain/imports.ts:568-569`:

```ts
lifecycleState: TestCaseLifecycleState.APPROVED,
authorUserId: ctx.actorId,
```

Every test case the workbook creates is persisted **Approved**, with authorship attributed to
whoever ran the import.

**Why this is not the author's decision.** `docs/excel-source-map.md:50` is explicit:

> The workbook does not define user accounts, roles, **approvals**, audit fields, defect
> transitions, evidence, release readiness, or API behavior.

And `docs/roles-workflows.md:23-28` defines the only route to Approved: Draft → In Review →
Approved, approved by a Senior QA Engineer **who is not the author**. This import produces Approved
records that passed through none of that, authored by the person who approved them.

**The genuine dilemma, stated fairly.** The author was not careless — they were cornered:

- `docs/data-model.md:46` — *"Every execution references an Approved test case."*
- The workbook has a Test Execution sheet and an Execution History sheet, both of which
  `excel-source-map.md:18-19` says to import.
- So if imported cases are Draft, **every execution and history row is rejected** and two documented
  sheets cannot be imported at all. The code makes that consequence explicit at
  `imports.ts:707-708`, rejecting executions whose case is not Approved.

There is no reading of the documents that satisfies both rules. This is the same class of gap as the
reconciliation operation (`RECONCILIATION-POLICY-AMENDMENT-DRAFT.md`): a conflict between
authoritative documents that only the QA Lead can settle.

**What the implementation does well here:** each affected row's report carries
`"Imported as Approved."` in its `details` (`imports.ts:580`), so the decision is visible per record
rather than hidden.

**What is missing:** the run-level `policyGaps` array (`imports.ts:1169-1172`) records the Product
Status gap and the Execution Status gap but **does not mention this one** — by some distance the most
consequential invented policy in the file. A reader of the import report would not learn that the
review workflow had been bypassed wholesale.

**Options for the QA Lead:**

1. **Approve the current behaviour** and amend `roles-workflows.md` to state that seed-imported test
   cases enter as Approved, with the importing QA Lead recorded as author, because the workbook
   predates the workflow.
2. **Import as Draft** and accept that the Test Execution and Execution History sheets cannot be
   imported in v1 — amending `excel-source-map.md` accordingly.
3. **Add an `IMPORTED` provenance field** distinguishing "approved by review" from "approved by
   import", so the audit trail does not overstate what happened. This needs a data-model change.

Whichever is chosen, `authorUserId` remains a fabricated attribution. In a system whose purpose is
traceability, attributing authorship of every seeded test case to the importer should be a conscious,
documented choice rather than a column that had to be filled.

---

## W2. HIGH · The importer bypasses every domain service

**Verified:** `imports.ts` imports from `@/lib/*` and `@/domain/import-parsing` only. It contains no
import from `@/domain/catalogue`, `test-cases`, `executions`, `defects` or `traceability`. All writes
go directly through `tx.product.create`, `tx.testCase.create`, `tx.defect.create` and so on.

That contradicts two documents:

- `docs/architecture.md:30` — the Import module *"Must not own: Direct database writes that bypass
  domain services."*
- `CLAUDE.md:52` — *"imports must not bypass domain services."*

**The engineering reason is real.** Every domain service opens its own `prisma.$transaction` and
takes an `actor`, so they cannot be composed inside the import's batch transaction — and
`docs/business-rules-and-validation.md:44` requires the import to *"commit each dependency-consistent
batch atomically."* Calling `createProduct` per row would produce one transaction per row, which
breaks batch atomicity. The author chose the rule with the more concrete failure mode.

**The cost is duplication that will drift.** Business-ID patterns, hierarchy chaining, controlled
value checks and step-sequence validation are now enforced in two places — the domain services and
this file — with no shared implementation. `imports.ts` does reuse `BUSINESS_ID_PATTERNS` and
`ensureStepSequence` from `src/lib/`, which limits the damage, but the *composition* of those checks
is reimplemented. A future change to an interactive rule will not automatically reach the import.

**Resolution — pick one before merge:**

1. Refactor the domain services to accept an optional `tx`, and have the import call them. Correct,
   and the larger change.
2. Amend `architecture.md:30` to permit direct writes within the import's batch transaction, and
   state that the import owns mirroring the service rules. Cheaper, and honest about what the code
   does.

Merging without choosing leaves the codebase in documented violation of its own architecture.

---

## W3. HIGH · 1,194 lines of privileged mutation with no test coverage and no in-domain RBAC

**Coverage.** All 25 new tests target `import-parsing.ts` (265 lines). **`imports.ts` has zero
tests.** That is the file holding the reconciliation logic, the batch boundaries, the idempotency
comparisons, the lifecycle decision in W1, and the bug-link resolution — i.e. all the risk. The
tested module is the one that was already easy to get right.

This is not a demand for unit tests of Prisma calls. But the classification decisions inside
`imports.ts` — *changed values → RECONCILIATION_REQUIRED*, *identical values → SKIPPED_UNCHANGED*,
*unknown parent → REFERENCE_NOT_FOUND* — are pure logic wrapped in database calls, and could be
extracted and tested the way `import-parsing.ts` already is.

**RBAC.** `createImportRun` contains no `ensureRole`; the QA-Lead gate lives only in
`src/app/api/v1/imports/workbook/route.ts:8`. That matches the existing pattern
(`IMPLEMENTATION-AUDIT-2026-07-31.md` §5.9) but the stakes are now different: this function creates
and mutates records across nine tables. Any future caller — a CLI, a scheduled job, a test — bypasses
authorization entirely.

---

## W4. MEDIUM · A blank legacy field rejects an otherwise-valid test case

`import-parsing.ts:45-65` declares all fifteen Test Repository headers required, with
`optionalFields: []`. So a row with an empty **Execution Status** cell is classified `PARTIAL` and
rejected as `ROW_INCOMPLETE`.

But `docs/excel-source-map.md:16` describes that column as seeding *"only a legacy summary; it does
not create an execution."* Requiring a legacy summary to be populated, on pain of discarding the test
case, is stricter than the document supports — and `business-rules-and-validation.md:43` reserves
`ROW_INCOMPLETE` for *partially populated* rows, which a row missing only a legacy annotation
arguably is not.

**Fix:** move `Execution Status` to `optionalFields`. Low risk, and it prevents silent data loss on
real workbooks.

---

## W5. MEDIUM · Date parsing is locale-ambiguous and fails silently

`import-parsing.ts:203-208`:

```ts
const parsed = new Date(trimmed);
return Number.isNaN(parsed.getTime()) ? null : parsed;
```

For non-ISO strings, `new Date(string)` is implementation-defined. `"01/02/2026"` parses as
2 January in a US locale and 1 February in most others — **both succeed**, so there is no error to
report. The result becomes `occurredAt` on an `ExecutionHistory` row, which `data-model.md:48`
makes immutable.

A silently wrong date in an append-only audit record is worse than a rejected row. The Excel serial
branch (`:201`) and the `Date` object branch are both sound; only the string branch is exposed, and
it is reachable whenever a workbook stores dates as text.

**Fix:** accept `Date` objects and Excel serials, accept strings only when they match ISO-8601, and
reject anything else with `ROW_INCOMPLETE` or a dedicated message. Rejecting is recoverable;
a wrong timestamp is not.

---

## W6. ~~MEDIUM~~ **RESOLVED 2026-07-31** · Merging materially widened two open production blockers

> **Both landed on `main`**, so the branch inherits them at its next rebase and the
> merge no longer widens anything:
>
> - **A1** — `xlsx` migrated from the frozen npm 0.18.5 to the vendor-distributed
>   0.20.3. The four high-severity advisories are gone from `npm audit`. This matters
>   more for the branch than for `main`: the branch adds `sheet_to_json` across eleven
>   sheets, so it was the change that would have exposed the parser surface.
> - **A2** — an upload size limit, checked against `Content-Length` *before*
>   `request.formData()` buffers the body, and against `file.size` after.
>
> Verified live: a 12 MB payload is refused with `422 ID_INVALID`, a valid workbook
> still imports, and a non-QA-Lead is still refused first.

The original finding follows.



Neither is caused by this branch, but merging changes their severity
(`PRODUCTION-READINESS-2026-07-31.md`):

- **A1 — `xlsx` has four unfixed high-severity CVEs** (prototype pollution, ReDoS) with *no fix
  available* on npm. Today the stub calls `XLSX.read` and little else. This branch adds
  `sheet_to_json` across eleven sheets and full row traversal, greatly increasing the parsing
  surface exposed to an uploaded file.
- **A2 — the upload endpoint has no size limit**; `route.ts:16` reads the whole file into memory.

**Recommendation:** land the `xlsx` migration to the vendor-distributed build and the size limit
**before or with** this merge, not after.

---

## W7. NOTE · Wrong error code for a missing sheet

`imports.ts:1073` throws `422 REFERENCE_NOT_FOUND` for an absent worksheet. `REFERENCE_NOT_FOUND` is
documented (`business-rules-and-validation.md:12`) for a missing *referenced record*. A missing sheet
is a malformed file. Inherited from the stub on `main`, not introduced here — worth fixing while the
file is open.

## W8. NOTE · The reconciliation blocker is unchanged

`RECONCILIATION_REQUIRED` rows are correctly reported **without being written**
(`business-rules-and-validation.md:45`), and the row report records the target record's id. But the
*proposed* values are recorded only inside the free-text `details` string — `ImportRowReport` still
has no structured field for them.

That is exactly the blocking obstacle described in `RECONCILIATION-POLICY-AMENDMENT-DRAFT.md` §1.1:
after the run, the differing source values no longer exist in structured form, so no follow-up
operation can apply them. Merging this branch does not resolve that, and the draft amendment's
proposed `proposedValuesJson` column remains necessary.

## W9. NOTE · Final audit event is written outside a transaction

`imports.ts:1177` calls `appendAudit(prisma, …)` after the run status update at `:1160`, so the
`IMPORT_COMPLETED` event and the `COMPLETED` status are not atomic. A crash between them leaves a
completed run with no completion event. Every per-record audit inside the batches is correctly
transactional; only this last one is not.

---

## What this branch gets right

Recorded deliberately, because the findings above should not obscure that this is good work.

- **Header validation happens before any write** (`imports.ts:1077-1096`), matching
  `excel-source-map.md:27`, and reports *all* failing sheets rather than the first.
- **`findHeaderRow` scans for the header row** rather than assuming row 1, so title rows and banner
  rows do not break the import. Unknown extra columns are collected and reported, then ignored —
  exactly `business-rules-and-validation.md:42`.
- **Batch atomicity is real.** `commitBatch` (`:153-176`) writes the entities, their
  `ImportRowReport` rows, *and* their audit events inside one transaction, with a 60s timeout. A
  failed batch leaves no partial dependent writes, satisfying `excel-source-map.md:34`.
- **Idempotency is implemented properly.** Existing business ID with identical normalised values →
  `SKIPPED_UNCHANGED`; different values → `RECONCILIATION_REQUIRED`, **uncommitted**. That is
  `business-rules-and-validation.md:45` done correctly, including the harder half.
- **In-sheet duplicates are caught** with `ID_DUPLICATE` before hitting the database constraint.
- **Tester resolution refuses to invent.** `imports.ts:712-729` matches `displayName` exactly, falls
  back to case-insensitive email, and **rejects** on no match, ambiguity, or an inactive user —
  rather than creating users the workbook does not define (`excel-source-map.md:50`). Ambiguity
  producing a rejection rather than a guess is the right instinct.
- **`Not Executed` is handled as documented** — treated as invalid rather than mapped to a result
  (`excel-source-map.md:46`), and no defect status mappings are invented
  (`import-parsing.ts:237-244`).
- **`sourceFileHash` (sha256), `completedAt` and a `RUNNING`/`COMPLETED`/`FAILED` status** are all
  populated — three gaps the stub left open.
- **Failure is honest.** On an exception the run is marked `FAILED` and the message states that
  committed batches were preserved, rather than implying a rollback that did not happen.
- **Policy gaps are recorded in the run report** rather than resolved in code — the right instinct,
  and the reason W1's omission from that list stands out.
- **The parsing layer is genuinely pure** — no Prisma, no I/O — with 25 tests including one
  end-to-end case through the real `xlsx` path.

---

## Recommendation

**Do not merge yet.** In order:

1. **Put W1 to the QA Lead.** Nothing else matters until the Approved-on-import question is
   answered; option 3 (a provenance field) would change the schema and therefore the code.
2. **Decide W2** — refactor the services to accept a `tx`, or amend `architecture.md`. Record which.
3. **Fix W4 and W5** — both are small, and both prevent silent data loss on real workbooks.
4. **Land A1 and A2** from the production audit, ideally before this merge.
5. **Add tests for the classification logic in `imports.ts`** (W3), extracting it the way
   `import-parsing.ts` already is.
6. **Then rebase onto `main`.** The rebase itself should be mechanical: the nine commits now on
   `main` touched neither file this branch changes. That window narrows with every further commit,
   so this should not be left to drift.

---

*Prepared 2026-07-31. Companion to `IMPLEMENTATION-AUDIT-2026-07-31.md` and
`PRODUCTION-READINESS-2026-07-31.md`. Establishes no policy; W1 and W2 are escalations, not
decisions.*
