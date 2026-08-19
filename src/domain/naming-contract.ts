import { AppError } from "@/lib/errors";

/**
 * The automation naming contract: the document a QA Lead hands an automation team so their
 * spec names reach the right QAMS test cases.
 *
 * ## Why this is Markdown and not a results file
 *
 * The obvious artefact would be a JUnit XML naming the selected cases, and it is the one
 * thing this must not be. JUnit XML has no way to say "unknown" — every `<testcase>` is a
 * claim of passed unless it carries a failure, error or skip — so a generated file naming
 * REAL business IDs cannot be neutral. The moment anyone uploaded it, QAMS would record that
 * automation observed something it never observed, on real cases, permanently and with no
 * way to mark the checks as invented. `check-sample.ts` avoids that by naming a case that
 * almost certainly does not exist; this file avoids it by not being ingestible at all.
 *
 * The two compose: `qams-check-sample.xml` teaches the SHAPE a runner must emit, this
 * teaches which IDs to put in it. One job each.
 *
 * ## Approved cases only
 *
 * The callers feed this from `listApprovedCandidates`, on the same rule execution planning
 * uses: a Draft may still change and a Retired case should not be automated, so neither
 * belongs in a contract someone is about to write specs against.
 *
 * Pure: no Prisma, no filesystem, no session, and the instant arrives as an argument rather
 * than from a clock, so the output is a function of its input alone.
 */

/** One case as the contract states it. A projection of `listApprovedCandidates`. */
export type ContractCase = {
  businessId: string;
  title: string;
  featureBusinessId: string;
  featureName: string;
  moduleName: string;
};

export const NAMING_CONTRACT_FILENAME = "qams-naming-contract.md";

/**
 * `YYYY-MM-DD HH:MM UTC`.
 *
 * Deliberately not the viewer's own zone and format, which is what every screen renders
 * (ADR-0007). This document leaves QAMS and is read by people in another system, possibly
 * another country, with no way to ask what zone it meant — so it states one, and states it
 * in the text rather than only in a machine-readable attribute a Markdown file has nowhere
 * to put.
 */
function stamp(instant: Date): string {
  const iso = instant.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** Feature groups in business-ID order, each holding its cases in business-ID order. */
function groupByFeature(cases: readonly ContractCase[]) {
  const groups = new Map<string, { heading: string; cases: ContractCase[] }>();

  for (const one of cases) {
    const existing = groups.get(one.featureBusinessId);
    if (existing) existing.cases.push(one);
    else {
      groups.set(one.featureBusinessId, {
        // Module first, because a feature name alone ("Card payment") is ambiguous across
        // products in a way the picker's own grouping already accounts for.
        heading: `${one.moduleName} · ${one.featureName} (${one.featureBusinessId})`,
        cases: [one]
      });
    }
  }

  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, group]) => ({
      heading: group.heading,
      cases: [...group.cases].sort((a, b) => a.businessId.localeCompare(b.businessId))
    }));
}

/**
 * The contract as Markdown text.
 *
 * Refuses an empty selection rather than emitting a document with no cases in it: a contract
 * naming nothing is indistinguishable from a contract someone forgot to fill in, and it
 * would be handed on as though it said something.
 */
export function buildNamingContract(cases: readonly ContractCase[], generatedAt: Date): string {
  if (cases.length === 0) {
    throw new AppError(422, "ID_INVALID", "Choose at least one test case.", "cases");
  }

  const lines: string[] = [
    "# Automation naming contract",
    "",
    `Generated from QAMS on ${stamp(generatedAt)} · ${cases.length} test case${cases.length === 1 ? "" : "s"}`,
    "",
    "A spec reaches a QAMS test case by **naming its business ID** — in the test's own name,",
    "or in the name of the describe block above it. Nothing else links the two: QAMS stores no",
    "binding between a case and a spec, so a case not named here is one automation cannot",
    "report on.",
    "",
    "Approved cases only. A Draft may still change and a Retired case should not be automated.",
    "For the shape of the results file your runner must emit, download the sample results file",
    "from Admin → Automation checks.",
    ""
  ];

  for (const group of groupByFeature(cases)) {
    lines.push(`## ${group.heading}`, "");
    for (const one of group.cases) lines.push(`- \`${one.businessId}\` — ${one.title}`);
    lines.push("");
  }

  return lines.join("\n");
}
