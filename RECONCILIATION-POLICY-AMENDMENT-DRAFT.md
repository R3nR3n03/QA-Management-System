# DRAFT — Import Reconciliation Policy Amendment

> **STATUS: DRAFT. NOT APPROVED. NOT AUTHORITATIVE.**
>
> This document is a *proposal* prepared for QA Lead review. It is deliberately **outside `docs/`**,
> because `docs/` is the approved single source of truth and this content has not been approved.
> Nothing here may be treated as policy, cited by the AI copilot, or implemented in code until a QA
> Lead approves it and the changes are merged into the authoritative documents listed in
> §6 "Documents this amendment would change".
>
> Prepared: 2026-07-29. Prepared by: implementation agent, at Engineer request.

---

## 1. Why this amendment is needed

`docs/api-and-security.md:47` states:

> Reconciliation-required rows remain uncommitted until a QA Lead explicitly resolves them through
> **a documented follow-up operation**.

**No such operation is documented anywhere in `docs/`.** The endpoint table twelve lines above that
sentence contains no reconciliation endpoint, and no other document defines the operation's
behaviour, inputs, or effects. The reference is circular: the only documentation of the operation is
a promise that documentation exists.

Consequently the operation **cannot be implemented** without inventing policy, which
`docs/README.md` § "SSOT operating rule" and `CLAUDE.md` both forbid.

### 1.1 A blocking practical obstacle

Independently of the policy gap, the operation is **not implementable against the current data model**.

`business-rules-and-validation.md:45` requires that a changed existing ID "cannot overwrite
automatically", and the implemented import therefore reports `RECONCILIATION_REQUIRED` rows
**without writing them**. But `ImportRowReport` (`prisma/schema.prisma`) has no structured field for
the *proposed* values — only a free-text `details` string:

```
model ImportRowReport {
  id, importRunId, sourceSheet, sourceRow,
  outcome, errorCode, recordId, details, createdAt, createdBy
}
```

So after an import completes, **the differing source values no longer exist anywhere in the system**.
There is nothing for a follow-up operation to apply. Any implementation requires either a schema
change to stage those values, or a requirement that the QA Lead re-upload the workbook. That is a
data-model decision, and `data-model.md` outranks `api-and-security.md` in the authority order.

### 1.2 What *is* already established (and is not in question)

| Established fact | Source |
|---|---|
| Trigger: existing business ID + different normalized values → `RECONCILIATION_REQUIRED` | `business-rules-and-validation.md:45` |
| Changed values require a QA-Lead-approved reconciliation | `excel-source-map.md:34` |
| QA Lead exclusively owns import reconciliation | `roles-workflows.md:16` |
| QA Lead "owns exceptional reconciliation decisions" | `roles-workflows.md:19` |
| Rows remain uncommitted until explicitly resolved | `api-and-security.md:47` |
| "Correct rejected source data or explicitly reconcile changed existing IDs; do not force overwrite" | `sops.md:40` |
| Imports and record updates require audit events | `business-rules-and-validation.md:50` |

This amendment does not alter any of the above. It only supplies the missing operation.

---

## 2. The eight open decisions, with recommendations

Each recommendation states its grounding and flags where the source text admits more than one
defensible reading. **Decisions 6 and 8 are conflicts between authoritative documents, not mere
gaps** — the QA Lead must settle those two regardless of what else is accepted.

---

### Decision 1 — What does "resolve" actually do?

**Ambiguity.** `business-rules-and-validation.md:45` forbids overwriting "automatically";
`sops.md:40` says "do not force overwrite". Read narrowly, overwriting is banned outright and
reconciliation can only ever discard the incoming values — which would make the operation pointless.
Read against `api-and-security.md:47` ("until a QA Lead explicitly resolves them"), the prohibition
targets *silent, automatic* overwriting, and an explicit human decision is exactly what lifts it.

**Recommendation.** Adopt the second reading. Each pending row is resolved individually with one of
exactly two decisions:

- **`ACCEPT_SOURCE`** — the workbook values are applied to the existing record (subject to
  Decisions 7 and 8).
- **`KEEP_CURRENT`** — the existing record stands unchanged; the proposal is discarded.

Both require a non-blank `rationale` and both emit an audit event. There is **no bulk "accept all"**
in v1: a batch accept would reintroduce precisely the automatic-overwrite hazard the rules exist to
prevent.

**If the QA Lead prefers the narrow reading**, `ACCEPT_SOURCE` is dropped, the operation becomes
acknowledge-and-discard only, and source data must instead be corrected in the workbook and
re-imported. That is coherent and safe, but means the workbook can never update an existing record.

---

### Decision 2 — Endpoint and granularity

**Recommendation.** Two endpoints, following the existing convention that transition-style endpoints
accept only a documented decision plus supporting fields and never an arbitrary patch
(`api-and-security.md:17`):

```
GET  /api/v1/imports/{id}/reconciliations
     Lists pending RECONCILIATION_REQUIRED rows for that run: source sheet/row,
     business ID, target record id, the proposed values, the current values,
     and the target record's current `version`.

POST /api/v1/imports/{id}/reconciliations/{reportRowId}/resolve
     Body: { decision: "ACCEPT_SOURCE" | "KEEP_CURRENT", rationale: string, version: number }
     Resolves exactly one row.
```

**One row per request**, deliberately. It matches "explicitly resolves", it makes each decision
individually auditable, and each target record carries its own optimistic `version` which a batch
call could not coherently supply.

QA Lead only, enforced in the domain service (`roles-workflows.md:16`).

---

### Decision 3 — Where the proposed values are stored

**Recommendation.** Persist them at import time, as part of the report row that is already being
written:

- Add **`proposedValuesJson Json?`** to `ImportRowReport`, populated only for
  `RECONCILIATION_REQUIRED` rows. This is written **once, at row creation**, so it does not weaken
  the "immutable completion report" property in `data-model.md:38`.

Rejected alternatives: a separate staging table (more machinery for no benefit, since the lifetime is
identical to the report row's); requiring workbook re-upload (loses the report/proposal link, and
`sops.md:42` requires the Import Run report be retained as the durable record).

---

### Decision 4 — Staleness

**Recommendation.** Two protections:

1. A resolution is rejected with `VERSION_CONFLICT` if the target record changed after the import
   ran (Decision 5 provides the mechanism).
2. A pending row is **superseded** — no longer resolvable — once a later import run reports on the
   same business ID. The newer run's proposal is the live one. Superseded rows are shown as such in
   the `GET` listing rather than silently hidden.

No time-based expiry: the knowledge base defines no retention periods anywhere
(`architecture.md:49` explicitly escalates retention to the QA Lead), so inventing one here would be
out of order.

---

### Decision 5 — Which optimistic `version`

**Recommendation.** The **target record's current version at apply time**, supplied by the client and
checked with the same `ensureVersion` used by every other mutation
(`api-and-security.md:5`, `business-rules-and-validation.md:15`). The `GET` listing returns that
version so the caller can supply it. This requires no new concept.

---

### Decision 6 — CONFLICT: is the report row mutated? *(must be settled)*

**The conflict.** Recording a resolution on the `ImportRowReport` row contradicts `data-model.md:38`,
which specifies the Import run as an **"immutable completion report"**, and
`business-rules-and-validation.md:50`, under which import records are append-only.

**Recommendation — resolve without weakening either rule.** Leave `ImportRowReport` immutable after
creation. Record each resolution as a **new, append-only record**:

```
model ImportReconciliation {
  id, importRowReportId, decision, rationale,
  resolvedBy, resolvedAt, appliedRecordId, createdAt, createdBy
}
```

`GET /imports/{id}` joins the two for display. A row is "pending" when it has no resolution record.
This mirrors how the system already handles corrections everywhere else — execution history and
audit events are append-only, and `data-model.md:48` states that "corrections create a new event or
execution, never overwrite". Reconciliation should behave the same way.

---

### Decision 7 — Does applying re-run validation?

**Recommendation.** Yes, and this matters. Applying `ACCEPT_SOURCE` must re-run the same validations
the interactive path enforces — active controlled values, hierarchy chain consistency, business-ID
format — because time has passed since the import: a controlled value may have been deactivated, a
parent may have been retired. On failure the resolution is refused with the normal stable error code
(`CONTROLLED_VALUE_INVALID`, `HIERARCHY_MISMATCH`, …) and the row stays pending.

Grounding: `api-and-security.md:39` requires business rules be re-checked in services;
`business-rules-and-validation.md:5` requires validation before persistence.

---

### Decision 8 — CONFLICT: lifecycle immutability *(must be settled)*

**The conflict.** `roles-workflows.md:30` states plainly:

> Approved content is immutable. A material change requires a new Draft revision linked to the prior
> test case.

A reconciliation that rewrites an Approved test case violates this directly. The same tension applies
to Finalized executions (`roles-workflows.md:39`, "a finalized execution cannot return to In
Progress") and to append-only `ExecutionHistory` rows (`data-model.md:48`).

**Authority order settles the precedence:** `roles-workflows.md` is authority #2,
`api-and-security.md` is #4. **Lifecycle immutability wins.**

**Recommendation.**

- **Approved test case** + `ACCEPT_SOURCE` → do **not** mutate the approved record. Instead create a
  **new Draft revision** carrying the workbook values, linked to the prior case via the existing
  `TestCase.revisesTestCaseId` field. This is exactly the remedy `roles-workflows.md:30` prescribes,
  and the field already exists. The new Draft then follows the normal review workflow.
- **Retired test case, Finalized execution, `ExecutionHistory` row, Closed defect** → `ACCEPT_SOURCE`
  is **refused** with `FORBIDDEN_TRANSITION`. Only `KEEP_CURRENT` is available. Rerun work creates a
  new execution (`roles-workflows.md:39`); it is never reconciled into history.
- **Draft test case, catalogue records (Product/Module/Feature/Requirement), New defect, Planned
  execution, controlled values** → `ACCEPT_SOURCE` applies the values directly, subject to
  Decisions 5 and 7.

This keeps every existing lifecycle rule intact and adds no exemption.

---

## 3. Rules this amendment would add to `business-rules-and-validation.md`

Proposed new subsection, *Reconciliation rules*:

- A `RECONCILIATION_REQUIRED` row is resolved only by a QA Lead, one row per request, with a decision
  of `ACCEPT_SOURCE` or `KEEP_CURRENT` and a non-blank rationale.
- `ACCEPT_SOURCE` re-runs all applicable validation before persisting; failures return the same
  stable error codes as the interactive path and leave the row pending.
- `ACCEPT_SOURCE` never mutates lifecycle-immutable content. For an Approved test case it creates a
  linked Draft revision; for Retired cases, Finalized executions, execution history, and Closed
  defects it is refused with `FORBIDDEN_TRANSITION`.
- A resolution requires the target record's current `version`; a stale version returns
  `VERSION_CONFLICT`.
- A pending row is superseded once a later import run reports on the same business ID.
- Import row reports are never mutated. Each resolution is a new append-only record.
- Every resolution emits an audit event recording actor, decision, rationale, target record, and
  request ID.

**New error code required:** none. `FORBIDDEN_TRANSITION`, `VERSION_CONFLICT`,
`CONTROLLED_VALUE_INVALID`, `HIERARCHY_MISMATCH`, and `UNAUTHORIZED` cover every case above.

---

## 4. Acceptance scenarios for `testing-and-acceptance.md`

| Area | Scenario | Expected result |
|---|---|---|
| Reconciliation | Non-QA-Lead attempts to resolve a row | `403`; no change |
| Reconciliation | `KEEP_CURRENT` on a pending row | Record unchanged; resolution recorded; row no longer pending |
| Reconciliation | `ACCEPT_SOURCE` on a Draft test case | Workbook values applied; `version` incremented; audit event exists |
| Reconciliation | `ACCEPT_SOURCE` on an **Approved** test case | Approved record unchanged; a new Draft revision is created linked via `revisesTestCaseId` |
| Reconciliation | `ACCEPT_SOURCE` on a Finalized execution | `422 FORBIDDEN_TRANSITION`; execution and history unchanged |
| Reconciliation | Resolve with a stale `version` | `409 VERSION_CONFLICT`; row stays pending |
| Reconciliation | `ACCEPT_SOURCE` whose priority is now a deactivated controlled value | `422 CONTROLLED_VALUE_INVALID`; row stays pending |
| Reconciliation | Resolve a row already resolved | `422`; the original resolution stands, report row never mutated |
| Reconciliation | Resolve a superseded row | `422`; caller directed to the newer import run |

---

## 5. SOP change

`sops.md` SOP-05 step 3 currently reads:

> 3. Correct rejected source data or explicitly reconcile changed existing IDs; do not force overwrite.

Proposed replacement plus a new step:

> 3. Correct rejected source data in the workbook and re-import, or resolve each changed existing ID
>    individually through the reconciliation operation. Never apply a bulk overwrite.
> 4. For each reconciliation-required row, review the proposed and current values, then record either
>    `ACCEPT_SOURCE` or `KEEP_CURRENT` with a rationale. Approved test cases are never edited in
>    place; accepting source values for one creates a new Draft revision that must be reviewed and
>    approved through SOP-01.

(Subsequent steps renumber.)

---

## 6. Documents this amendment would change

Per `docs/README.md` § "Versioning and change control", a policy change must update the affected
authoritative document, the acceptance scenarios, and any skill cross-references.

| Document | Change |
|---|---|
| `business-rules-and-validation.md` | Add the *Reconciliation rules* subsection (§3 above) |
| `roles-workflows.md` | Note that reconciliation resolution is a QA-Lead-only action and cannot bypass lifecycle immutability |
| `data-model.md` | Add `ImportRowReport.proposedValuesJson`; add the `ImportReconciliation` entity; restate that report rows remain immutable |
| `api-and-security.md` | Add the two endpoints to the Administration row; replace the dangling "a documented follow-up operation" sentence with a pointer to the new rules |
| `sops.md` | SOP-05 steps 3–4 (§5 above) |
| `testing-and-acceptance.md` | Add the nine acceptance scenarios (§4 above) |
| `skills/qa-management-system/SKILL.md` | No change expected — it links to policy documents rather than duplicating values. Confirm at approval time. |

---

## 7. Implementation consequences if approved

Not policy; recorded so the QA Lead understands the cost of approving.

- **Schema migration required** — two changes (`ImportRowReport.proposedValuesJson`, new
  `ImportReconciliation` model). The repository currently has **no `prisma/migrations/` baseline at
  all**, so this would be the first migration and the baseline must be established first.
- The import service must populate `proposedValuesJson`; it currently discards proposed values.
  That code is on the unmerged `feature/workbook-import` branch, so this work depends on that branch
  landing first.
- New domain service, two routes, RBAC, audit actions, and unit tests.
- The Approved-test-case path (Decision 8) reuses `revisesTestCaseId`, which already exists.

---

## 8. Questions the QA Lead must answer

1. **Decision 1** — Does explicit QA Lead action permit overwriting an existing record, or is
   reconciliation acknowledge-and-discard only? *(Everything else depends on this.)*
2. **Decision 6** — Confirm import row reports stay immutable and resolutions are separate
   append-only records.
3. **Decision 8** — Confirm lifecycle immutability outranks reconciliation, and confirm the
   Approved-test-case → new Draft revision remedy.
4. Confirm one-row-at-a-time with no bulk accept.
5. Confirm no time-based expiry for pending rows (superseded-by-newer-run only).
6. Confirm the seven other recommendations, or state the alternative.
