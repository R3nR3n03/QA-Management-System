/**
 * Length limits on free-text fields, as plain numbers.
 *
 * Its own module, and deliberately importing nothing: the domain enforces these, the request
 * schemas re-check them, and the forms pass them to `maxLength` so typing stops at the cap
 * instead of a paragraph being lost on submit. That last caller is a client component, and
 * the obvious home — `validation.ts`, next to `requireMaxLength` — reaches `@prisma/client`
 * through `errors.ts`, which would drag Prisma into the browser bundle for the sake of one
 * integer.
 *
 * One constant per rule, so its enforcers can never drift to different numbers.
 */

/**
 * An execution's purpose, measured on the trimmed value.
 *
 * The system's only length rule. Every other free-text field here is read on a detail page,
 * where length costs the reader nothing; a purpose is the headline of every row on
 * `/executions` and `/my-work`, so an unbounded one wrecks the row for every other run on
 * the page (`docs/business-rules-and-validation.md`).
 */
export const EXECUTION_PURPOSE_MAX_LENGTH = 120;
