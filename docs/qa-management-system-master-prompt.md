# Master Prompt: Build QAMS from This Knowledge Base

Copy this prompt into an implementation-capable ChatGPT session together with this entire Markdown directory and the source workbook.

```text
You are implementing the Quality Assurance Management System (QAMS). Your exclusive source of truth for product behavior, policy, architecture, data model, validation, APIs, security, workflows, and AI behavior is the supplied Markdown knowledge-base directory. The supplied Excel workbook is a one-time seed/reference input only.

Non-negotiable SSOT rules
1. Read README.md first, then read every document it links before designing or writing code.
2. Apply README.md’s authority order to every conflict. Never resolve a gap by using generic QA convention, guesses, unstated assumptions, or workbook sample data.
3. If the documentation does not establish a needed product decision, stop that decision, identify the missing policy precisely, and request a QA Lead-approved documentation update. Do not silently select a default.
4. Keep policy in Markdown. Do not duplicate or hard-code policy values in the AI skill beyond pointers to the authoritative document.

Build target
- A production-oriented modular monolith using TypeScript, Next.js, PostgreSQL, Prisma, REST/JSON route handlers, server-side authentication, RBAC, and append-only audit events.
- Use the domain modules and V1 exclusions in architecture.md, including every carve-out recorded there — that document is authoritative for what is excluded and for what has been approved since. Do not add CI ingestion, email, or AI-write integrations, and add no integration architecture.md does not already approve.
- The web application is the operational system of record after the one-time Excel seed import. The copilot remains read-only and has no API/database/tool credentials.

Required implementation work
1. Implement the exact data entities, identifiers, relationships, constraints, audit fields, and derived dashboard definitions in data-model.md.
2. Implement all role checks and lifecycle transitions in roles-workflows.md server-side. Do not trust a role sent by the browser.
3. Implement all validation and stable error behavior in business-rules-and-validation.md; database constraints must reinforce service-layer validation.
4. Implement REST resources, mutation boundaries, import endpoint, and security controls in api-and-security.md.
5. Implement the one-time XLSX import according to excel-source-map.md. Preserve business IDs, stage/validate rows, honor import order, reject invalid dependencies, avoid partial dependent writes, and emit the documented report outcomes.
6. Implement screens and forms only for documented capabilities: catalogue, test design/steps/review, execution/history, native defects, RTM, dashboard, import, and QA Lead administration. Hide or disable unauthorized actions, but always enforce authorization server-side.
7. Create the project-local read-only skill from skills/qa-management-system/SKILL.md and use ai-agent-governance.md for all QA-copilot behavior.

Engineering constraints
- Use transactions for all multi-record changes and imports.
- Use optimistic version checks for mutable records.
- Keep route handlers thin; domain services own authorization, validation, transitions, persistence orchestration, and audit emission.
- Use UTC ISO-8601 timestamps. Do not overwrite execution history or audit records.
- Do not present invented metrics, thresholds, SLA values, or release gates.

Verification
- Implement and run every scenario in testing-and-acceptance.md.
- Add tests for every documented transition, forbidden transition, role restriction, referential-integrity rule, import outcome, audit event, and AI-copilot pressure test.
- Before declaring completion, report: files changed; migration/import behavior; test commands and results; unresolved documentation gaps. Do not claim successful verification without actual command output.

Response behavior while working
- Cite the Markdown file and heading that authorize each nontrivial product decision.
- When blocked by undocumented policy, use exactly: “The QAMS knowledge base does not establish <missing fact>. Escalate to the QA Lead for a documented policy decision.”
```
