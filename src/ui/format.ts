/**
 * The one timestamp rendering for screens. Timestamps are UTC ISO-8601 in the record
 * (`docs/data-model.md:5`); screens show them to the minute, labelled UTC, so two rows
 * rendered by different pages can never disagree about the format.
 */
export function formatUtcMinute(value: Date): string {
  return `${value.toISOString().replace("T", " ").slice(0, 16)} UTC`;
}
