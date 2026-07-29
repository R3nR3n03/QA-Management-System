# Quality Assurance Management System Knowledge Base

## Authority and scope

This directory is the single source of truth (SSOT) for the Quality Assurance Management System (QAMS) implementation and its read-only AI copilot. When documents conflict, the following order wins:

1. `business-rules-and-validation.md`
2. `roles-workflows.md`
3. `data-model.md`
4. `api-and-security.md`
5. `architecture.md`
6. `sops.md`
7. `excel-source-map.md`
8. `ai-agent-governance.md`

The supplied Excel workbook is a one-time seed/reference source, not an ongoing policy authority. Its records are imported once; the web application is the operational system of record. The documentation owns the policy decisions that the workbook does not define.

## Navigation

| Document | Purpose |
| --- | --- |
| [Excel source map](excel-source-map.md) | Source sheets, fields, import order, and unsupported workbook behavior |
| [Architecture](architecture.md) | Next.js, API, persistence, boundaries, and audit architecture |
| [Data model](data-model.md) | Entities, keys, relationships, and controlled values |
| [Roles and workflows](roles-workflows.md) | RBAC and lifecycle transitions |
| [Business rules and validation](business-rules-and-validation.md) | Enforceable invariants and validation outcomes |
| [API and security](api-and-security.md) | REST contract, authorization, import, and security controls |
| [Standard operating procedures](sops.md) | Repeatable QA operating procedures |
| [AI agent governance](ai-agent-governance.md) | Retrieval-only behavior, evidence, refusals, and templates |
| [Testing and acceptance](testing-and-acceptance.md) | Required implementation and knowledge-base verification |
| [Master implementation prompt](qa-management-system-master-prompt.md) | Copy-ready prompt for an implementation agent |
| [QA copilot skill](skills/qa-management-system/SKILL.md) | Project-local, read-only AI skill |

## Terms

- **Product hierarchy:** Product → Module → Feature → Requirement.
- **Test case:** A reusable verification specification with ordered test steps.
- **Execution:** A time-bound run of one approved test case.
- **Defect:** A native record documenting a failure linked to a test case and, where known, a requirement.
- **RTM:** Requirement Traceability Matrix linking requirements, test cases, and defects.
- **Finalized:** A closed execution result that is immutable except through a new execution; never by editing history.

## SSOT operating rule

Implementation and AI responses must use only these Markdown files for policy and process claims. If the requested information is absent, ambiguous, or conflicts with this authority order, respond that the knowledge base does not establish it and escalate to the QA Lead. Do not fill gaps from general QA practice, the workbook, or assumptions.

## Versioning and change control

Every policy change must update the affected authoritative document, the acceptance scenarios, and any cross-references in the skill. A QA Lead approves policy changes. The skill contains process instructions only and must link to policy documents instead of duplicating policy values.
