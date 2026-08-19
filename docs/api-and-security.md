# API and Security Contract

## REST conventions

Base path: `/api/v1`. JSON requests and responses use camelCase. Collection endpoints support server-side pagination, filtering, and sorting only for documented fields. All endpoints require an authenticated session. Mutation requests require an optimistic `version` and return the updated record with its new `version`. `businessId` is optional on `POST /test-cases`, `POST /executions`, `POST /defects`, and on the per-case `createDefect` entries of `POST /executions/{id}/finalize`: when omitted the server allocates the next free ID in the documented format; when supplied it is validated for format and uniqueness exactly as before.

| Resource | Endpoints |
| --- | --- |
| Authentication | `POST /auth/login` verifies email/password and issues a server-side session cookie; `POST /auth/logout` clears it. `POST /users/me/password` changes the caller's own password after verifying the current one, revokes every other session, and re-issues the caller's session. Accounts are created by the QA Lead via `POST /users`. |
| Catalogue | `GET/POST /products`, `GET/PATCH /products/{id}` and equivalent modules, features, requirements |
| Test design | `GET/POST /test-cases`, `GET/PATCH /test-cases/{id}`, `POST /test-cases/{id}/submit`, `POST /test-cases/{id}/approve`, `POST /test-cases/{id}/return-to-draft`, `POST /test-cases/{id}/retire` |
| Steps | `PUT /test-cases/{id}/steps` replaces the complete validated ordered step set while case is Draft |
| Execution | `GET/POST /executions` (create takes `testCaseIds[]` — one or more Approved cases selected together), `PATCH /executions/{id}` (reassigns the tester; only while Planned), `POST /executions/{id}/start`, `POST /executions/{id}/finalize` (takes per-case `results[]` covering every case exactly once), `GET /executions/{id}/history` |
| Defects | `GET/POST /defects`, `GET/PATCH /defects/{id}` (only while New), `POST /defects/{id}/transition` |
| Traceability/reporting | `GET/POST /rtm-links`, `GET /dashboard`, `GET /release-readiness?productId=&release=&environment=` (advisory report only; no endpoint records the QA Lead's readiness decision in v1) |
| Administration | `POST /imports/workbook`, `GET /imports/{id}`, `GET/POST/PATCH /controlled-values` (POST adds a value to one of the three documented catalogues; PATCH toggles `active`; values are never renamed or deleted), `POST /users`, `PATCH /users/{id}` (either profile fields — displayName/email — or `active`, never both in one request), `GET/PATCH /users/{id}/role`, `POST /users/{id}/password` (QA Lead sets a new password for someone else's account, for when they cannot supply their current one; revokes every session they hold; refused for the caller's own account — use `POST /users/me/password` instead). There is no user list or user delete endpoint; deactivation via `active` is the only removal path. `POST /check-batches` uploads one JUnit XML results file and returns a Check Batch; `GET /check-batches/{id}` returns its row report. |

Every mutation routes through its domain service; direct ORM calls from route handlers are prohibited. The `transition` endpoints accept only the documented target state and required supporting fields; they never accept an arbitrary state patch.

## Error response

```json
{
  "error": {
    "code": "HIERARCHY_MISMATCH",
    "message": "The requirement does not belong to the supplied feature.",
    "field": "requirementId",
    "requestId": "uuid"
  }
}
```

Do not expose stack traces, SQL details, authorization rules, or internal identifiers beyond the requested record.

## Timestamps in responses

Every timestamp in an API response is **ISO-8601 UTC**, for every caller, regardless of the authenticated user's stored time zone, their chosen clock, or the deployment's zone. This is a contract and not an implementation detail: a caller holding an instant can convert it to any zone, but a caller handed a localized string cannot recover the instant without being told which zone produced it, so localizing a response would strictly destroy information.

Display preferences are a presentation concern and apply only to what a person is shown on a screen, or to a stamp QAMS writes for a reader outside it. See `data-model.md` § "Common record convention" and [ADR-0007](adr/0007-a-zone-for-readers-and-a-zone-for-outsiders.md).

## Authorization and security

- Authenticate on the server and resolve the active role from the database for each request. v1 authenticates with an email/password check against a server-stored password hash, then issues a signed, httpOnly, server-verified session cookie; the server never trusts a client-supplied identity header.
- Enforce the role/action matrix and ownership restrictions in `roles-workflows.md` in domain services.
- Use least privilege for database credentials; keep database access server-only.
- Validate JSON shape, scalar lengths, enums, and IDs at the request boundary; re-check business rules in services.
- Store secrets in deployment-managed environment variables. Never commit them, return them from APIs, or include them in audit logs.
- Sanitize displayed rich text as plain text in v1. Evidence is recorded as a reference string only; binary-upload storage is not defined in v1.
- Rate limit authentication and import endpoints, including automation check ingestion. Exact limits are deployment policy and are not defined here.
- Store outbound-integration credentials encrypted at rest under a deployment-managed key. They are never returned by the API, rendered in a screen, logged, or written to an audit event — the same rule the password hash already carries.

## Jira execution sync interface

**Status: implemented, with two gaps** — see the status note in `architecture.md#Jira execution sync` for the behavior this secures and for what is still missing.

Outbound only. QAMS calls Jira; Jira has no endpoint into QAMS, no webhook, and no credential here. There is nothing inbound to authorize.

Each user connects their own Jira identity through OAuth, so a transition is attributed to the person whose test run caused it. Because the push is retryable and may run long after the request that triggered it, QAMS stores that user's refresh token and uses it offline. A user may revoke their connection at any time.

A push that cannot use the triggering user's credential — never connected, revoked, expired, or unauthorized on that Jira project — falls back to a deployment-configured service account so that one person's token can never strand an issue permanently. Where the fallback is used, Jira records the service account and the QAMS audit event remains the only record of the real actor. The fallback may be disabled by deployment configuration, in which case such a push is a terminal failure requiring manual action.

QAMS resolves the target transition by Jira's `done` status category rather than by status name, because status names are user-editable text and categories are not. A deployment may override the transition per Jira project.

Every sync attempt is audited with actor, execution, issue key, and outcome. Credential material never appears in that event.

Result comments use the same connection, the same credential rules and the same audit obligation as a transition: every attempt to post one is recorded and audited with actor, execution, issue key, and outcome, and never carries token material. A comment is posted under the triggering user's own Jira identity wherever their credential can be used, so Jira attributes it to the person whose run produced it.

Whether result comments are posted at all is deployment configuration, and they are **off** unless a deployment enables them. QAMS also takes an optional public base URL for itself, used only to link a comment back to the run it reports; it is not a secret and is subject to no role restriction, and where it is absent the comment simply carries no link.

A failed result comment is not retried and exposes no retry endpoint. Its outcome, including the failure reason, is readable on the execution it belongs to by any role that may view that execution — the reason is sanitized of credential material, and the person who mistyped an issue key is the one best placed to correct it.

The Jira site's base URL is shown to every authenticated role, because an execution renders its issue key as a link into Jira. This is the one Jira connection value that is not restricted: it is the public address of the team's Jira site, which anyone holding an issue key can already reach. The client ID, the client secret, the encryption key, and every stored token remain unreadable at every role, masked or otherwise.

## Jira defect sync interface

**Status: implemented, off unless enabled, and awaiting QA Lead approval of the policy** — see the status note in `architecture.md#Jira defect sync`.

Outbound only, on the same connection, the same per-user OAuth identity, the same service-account fallback and the same audit obligation as the execution sync. Nothing here introduces a second credential, a second authorization model, or an inbound path.

The Jira **project** that raised bugs are created in is **not** deployment configuration: it is an attribute of the product, set in the Catalogue and readable and writable by the roles that may administer the catalogue. That is a deliberate widening over the other Jira values, and it is safe because a project key is not a secret and carries no access — it names a project, and anyone who can reach the Jira site can already list them. The client id, the client secret, the encryption key and every stored token remain in deployment-managed environment variables and unreadable at every role.

One value is added to deployment configuration: an optional issue type name, defaulting to `Bug`, which describes how a Jira site names its types rather than anything about one product. It is not a secret and is not exposed by the API.

A product's project key is validated for shape when it is saved, and never against Jira. Verifying it would let a Jira outage block catalogue editing, which is the same coupling the execution sync refuses when an issue key is recorded. A key naming a project that does not exist surfaces as a failed create attempt on a defect, where it costs nobody their work.

Every attempt to create, comment on, or transition a defect's issue is audited with actor, defect, issue key and outcome, and never carries token material. The actor recorded on the attempt is whose credential performed the write; the audit event names the person whose action caused the sync to exist, which for a retry is the person who raised the defect and is never a claim that they acted in Jira.

Creating an issue is the one Jira write that is not idempotent, so it is guarded rather than trusted: QAMS labels every issue it raises with the defect's business ID and searches for that label before creating, adopting an existing match instead of raising a duplicate. A create whose duplicate check cannot complete fails rather than proceeding.

Failed creates and failed transitions are retried on the same bounded budget and through the same QA-Lead-only retry endpoint as the execution sync; that endpoint reports the two queues' tallies separately. A failed lifecycle comment is not retried and exposes no retry endpoint.

Every attempt outcome, including the failure reason, is readable on the defect it belongs to by any role that may view that defect. Reasons are sanitized of credential material, and a defect whose issue was never raised says so on its own screen — that failure is invisible everywhere else, because a bug that never reached Jira does not exist for anyone working from the board.

## Workbook import interface

`POST /imports/workbook` accepts one `.xlsx` file and returns an Import Run. It validates structure, stages rows, executes the dependency order in `excel-source-map.md`, and returns a report. Reconciliation-required rows remain uncommitted until a QA Lead explicitly resolves them through a documented follow-up operation.

## Automation check ingestion interface

`POST /check-batches` accepts one JUnit XML results file and returns a Check Batch with a per-row report, in the shape `POST /imports/workbook` already returns. It is restricted to the role that may administer the system (`roles-workflows.md`).

Each `<testcase>` is resolved to a QAMS test case by the business ID its name declares, or failing that its class name — a `describe` block naming the case is a natural way to write a spec and is not worth refusing. A row whose ID resolves to nothing is reported `REFERENCE_NOT_FOUND` and creates no check; other rows in the same file are unaffected, because one mis-named spec must not discard a whole run's results. A malformed file is rejected before anything is written.

The endpoint writes **checks only**. It creates no test case, starts or finalizes no execution, raises no defect, and writes no trace link — there is no request shape that would let it, and no parameter enabling it. Re-posting the same file is not idempotent and is not meant to be: it records a second set of observations, which is what a second run is.

Checks carry no credential material and no evidence contents. A failure reason is the runner's message, stored as plain text under the same sanitization rule as every other displayed string.

## AI boundary

The QA copilot has no API credentials, tool binding, database query, or mutation endpoint. It cannot claim current system data, create records, or update defects. Its operating contract is exclusively `ai-agent-governance.md` and `skills/qa-management-system/SKILL.md`.
