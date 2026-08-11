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
| Administration | `POST /imports/workbook`, `GET /imports/{id}`, `GET/POST/PATCH /controlled-values` (POST adds a value to one of the three documented catalogues; PATCH toggles `active`; values are never renamed or deleted), `POST /users`, `PATCH /users/{id}` (either profile fields — displayName/email — or `active`, never both in one request), `GET/PATCH /users/{id}/role`, `POST /users/{id}/password` (QA Lead sets a new password for someone else's account, for when they cannot supply their current one; revokes every session they hold; refused for the caller's own account — use `POST /users/me/password` instead). There is no user list or user delete endpoint; deactivation via `active` is the only removal path. |

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

## Authorization and security

- Authenticate on the server and resolve the active role from the database for each request. v1 authenticates with an email/password check against a server-stored password hash, then issues a signed, httpOnly, server-verified session cookie; the server never trusts a client-supplied identity header.
- Enforce the role/action matrix and ownership restrictions in `roles-workflows.md` in domain services.
- Use least privilege for database credentials; keep database access server-only.
- Validate JSON shape, scalar lengths, enums, and IDs at the request boundary; re-check business rules in services.
- Store secrets in deployment-managed environment variables. Never commit them, return them from APIs, or include them in audit logs.
- Sanitize displayed rich text as plain text in v1. Evidence is recorded as a reference string only; binary-upload storage is not defined in v1.
- Rate limit authentication and import endpoints. Exact limits are deployment policy and are not defined here.
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

## Workbook import interface

`POST /imports/workbook` accepts one `.xlsx` file and returns an Import Run. It validates structure, stages rows, executes the dependency order in `excel-source-map.md`, and returns a report. Reconciliation-required rows remain uncommitted until a QA Lead explicitly resolves them through a documented follow-up operation.

## AI boundary

The QA copilot has no API credentials, tool binding, database query, or mutation endpoint. It cannot claim current system data, create records, or update defects. Its operating contract is exclusively `ai-agent-governance.md` and `skills/qa-management-system/SKILL.md`.
