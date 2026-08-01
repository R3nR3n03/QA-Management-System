# API and Security Contract

## REST conventions

Base path: `/api/v1`. JSON requests and responses use camelCase. Collection endpoints support server-side pagination, filtering, and sorting only for documented fields. All endpoints require an authenticated session. Mutation requests require an optimistic `version` and return the updated record with its new `version`.

| Resource | Endpoints |
| --- | --- |
| Authentication | `POST /auth/login` verifies email/password and issues a server-side session cookie; `POST /auth/logout` clears it. `POST /users/me/password` changes the caller's own password after verifying the current one, revokes every other session, and re-issues the caller's session. Accounts are created by the QA Lead via `POST /users`. |
| Catalogue | `GET/POST /products`, `GET/PATCH /products/{id}` and equivalent modules, features, requirements |
| Test design | `GET/POST /test-cases`, `GET/PATCH /test-cases/{id}`, `POST /test-cases/{id}/submit`, `POST /test-cases/{id}/approve`, `POST /test-cases/{id}/return-to-draft`, `POST /test-cases/{id}/retire` |
| Steps | `PUT /test-cases/{id}/steps` replaces the complete validated ordered step set while case is Draft |
| Execution | `GET/POST /executions` (create takes `testCaseIds[]` — one or more Approved cases selected together), `PATCH /executions/{id}` (reassigns the tester; only while Planned), `POST /executions/{id}/start`, `POST /executions/{id}/finalize` (takes per-case `results[]` covering every case exactly once), `GET /executions/{id}/history` |
| Defects | `GET/POST /defects`, `GET/PATCH /defects/{id}` (only while New), `POST /defects/{id}/transition` |
| Traceability/reporting | `GET/POST /rtm-links`, `GET /dashboard`, `GET /release-readiness?productId=&release=&environment=` (advisory report only; no endpoint records the QA Lead's readiness decision in v1) |
| Administration | `POST /imports/workbook`, `GET /imports/{id}`, `GET/POST/PATCH /controlled-values` (POST adds a value to one of the three documented catalogues; PATCH toggles `active`; values are never renamed or deleted), `POST /users`, `PATCH /users/{id}` (either profile fields — displayName/email — or `active`, never both in one request), `GET/PATCH /users/{id}/role`. There is no user list or user delete endpoint; deactivation via `active` is the only removal path. |

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

## Workbook import interface

`POST /imports/workbook` accepts one `.xlsx` file and returns an Import Run. It validates structure, stages rows, executes the dependency order in `excel-source-map.md`, and returns a report. Reconciliation-required rows remain uncommitted until a QA Lead explicitly resolves them through a documented follow-up operation.

## AI boundary

The QA copilot has no API credentials, tool binding, database query, or mutation endpoint. It cannot claim current system data, create records, or update defects. Its operating contract is exclusively `ai-agent-governance.md` and `skills/qa-management-system/SKILL.md`.
