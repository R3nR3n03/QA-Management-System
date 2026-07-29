import { describe, expect, it } from "vitest";
import {
  buildControlledValueSeedRows,
  CATALOGUE_PRIORITY,
  CATALOGUE_RESULT,
  CATALOGUE_SEVERITY,
  SEED_CONTROLLED_VALUES
} from "./controlled-value-catalogues";

describe("controlled-value catalogue names", () => {
  it("match the exact TitleCase literals the domain services pass", () => {
    // ensureActiveControlledValue matches case-sensitively, so drift here silently
    // turns every priority/severity check into a 422.
    expect(CATALOGUE_PRIORITY).toBe("Priority");
    expect(CATALOGUE_SEVERITY).toBe("Severity");
    expect(CATALOGUE_RESULT).toBe("Result");
  });
});

describe("SEED_CONTROLLED_VALUES", () => {
  it("contains exactly the nine values documented in excel-source-map.md", () => {
    const pairs = SEED_CONTROLLED_VALUES.map((entry) => `${entry.catalogue}:${entry.value}`);

    expect(pairs.slice().sort()).toEqual(
      [
        "Priority:High",
        "Priority:Medium",
        "Priority:Low",
        "Severity:Critical",
        "Severity:Major",
        "Severity:Minor",
        "Result:Pass",
        "Result:Fail",
        "Result:Blocked"
      ].sort()
    );
  });

  it("has no duplicate (catalogue, value) pairs", () => {
    const pairs = SEED_CONTROLLED_VALUES.map((entry) => `${entry.catalogue}:${entry.value}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("uses only the three known catalogues", () => {
    const catalogues = new Set(SEED_CONTROLLED_VALUES.map((entry) => entry.catalogue));
    expect([...catalogues].sort()).toEqual(["Priority", "Result", "Severity"]);
  });

  it("excludes the legacy 'Not Executed' source value", () => {
    expect(SEED_CONTROLLED_VALUES.some((entry) => entry.value === "Not Executed")).toBe(false);
  });
});

describe("buildControlledValueSeedRows", () => {
  it("stamps createdBy and updatedBy on every row", () => {
    const rows = buildControlledValueSeedRows("seed");

    expect(rows).toHaveLength(SEED_CONTROLLED_VALUES.length);
    for (const row of rows) {
      expect(row.createdBy).toBe("seed");
      expect(row.updatedBy).toBe("seed");
    }
  });

  it("preserves the catalogue and value of each seed entry", () => {
    const rows = buildControlledValueSeedRows("someone-else");

    expect(rows.map(({ catalogue, value }) => ({ catalogue, value }))).toEqual(
      SEED_CONTROLLED_VALUES.map(({ catalogue, value }) => ({ catalogue, value }))
    );
  });
});
