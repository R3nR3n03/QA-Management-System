import type { SeededData } from "../support/accounts";

/**
 * Ingesting an automation results file, end to end through the screen.
 *
 * What only a browser can prove here: that the upload is a real multipart server action from a
 * rendered form, that the batch it writes appears on the list with the right tallies, and that
 * the per-row report reached the detail screen. `tests/acceptance/automation-checks.test.ts`
 * already proves the domain service's rules against PostgreSQL; this proves the screens on top
 * of it agree with them.
 *
 * It also pins the two things about this feature that are easiest to break by accident:
 * unresolved rows are still reported, and the screen is ABSENT for a role that may not use it
 * rather than present-and-rejecting.
 */
describe("Ingesting automation results", () => {
  let seeded: SeededData;

  /*
   * The tests below run in ORDER against accumulating state: empty, then ingested, then read back.
   *
   * Deliberate, and not merely convenient. Ingestion is append-only by design (ADR-0008 —
   * re-uploading records a second set of observations rather than replacing the first), so "the
   * list is empty" and "the list has one batch" can never be true of one database at one time.
   * Something has to go first.
   *
   * This is also the only spec that writes check batches, which is what makes the shared run-wide
   * seed safe here: no other spec can put a row in that list ahead of the empty-state assertion,
   * and nothing after this one reads it.
   */
  before(() => {
    cy.seeded().then((data) => {
      seeded = data;
    });
  });

  /**
   * A results file naming the seeded approved case, plus two rows that must survive alongside it:
   * one naming a case that does not exist, and one naming none at all. Built here rather than
   * kept as a fixture because the business ID has to match what the seed actually created — a
   * static file would silently drift into testing nothing but REFERENCE_NOT_FOUND.
   */
  const resultsFile = (businessId: string) =>
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<testsuites>",
      '  <testsuite name="checkout/guest.cy.ts">',
      `    <testcase name="${businessId} rejects an expired card" />`,
      `    <testcase name="${businessId} shows the decline reason">`,
      '      <failure message="expected the decline banner to be visible" />',
      "    </testcase>",
      '    <testcase name="TC-NOSUCH-9999 names a case that is not here" />',
      '    <testcase name="declares no test case at all" />',
      "  </testsuite>",
      "</testsuites>"
    ].join("\n");

  it("shows the furnished empty state before anything has been ingested", () => {
    cy.loginAs("QA_LEAD");
    cy.visit("/admin/checks");

    cy.contains("h1", "Automation checks").should("be.visible");
    cy.contains("No results ingested yet").should("be.visible");
    // The call to action points at the form that fills it, on this same screen.
    cy.contains("a", "Ingest a results file").should("have.attr", "href", "#ingest");
    // The table only exists once there is a row for it.
    cy.get("table.data-table").should("not.exist");
  });

  it("records a batch, tallies it, and keeps the rows that resolved to nothing", () => {
    cy.loginAs("QA_LEAD");
    cy.visit("/admin/checks");

    cy.hydrated('input[type="file"]').selectFile(
      {
        contents: Cypress.Buffer.from(resultsFile(seeded.approvedCase.businessId)),
        fileName: "guest-checkout.xml",
        mimeType: "text/xml"
      },
      { force: true }
    );
    cy.contains("button", "Ingest results").click();

    /*
     * A successful upload does not come back to the list — `actions.ts` redirects to the batch
     * it just wrote. That is the confirmation, and it is the right one: the per-row report is
     * the only place the rows that resolved to nothing are visible, and those are precisely
     * what a person needs to see before they trust the tallies.
     */
    cy.contains("h1", "guest-checkout.xml").should("be.visible");
    // Said out loud on the report, because a run that quietly dropped these would look like a
    // shorter run rather than a naming problem.
    cy.contains("2 of 4 tests recorded no check").should("be.visible");
    cy.contains("TC-NOSUCH-9999").should("be.visible");
    cy.contains("No such test case").should("be.visible");
    cy.contains("Names no test case").should("be.visible");

    /*
     * The head's tally is the row filter, so the number a reader sees IS the control. Both
     * halves are asserted: that the counts are right, and that pressing one narrows the table
     * to exactly them. A slot counting nothing is disabled rather than hidden — its position is
     * what makes the others findable between batches.
     */
    cy.get(".tally-slot").should("have.length", 6);
    cy.contains(".tally-slot", "Passed").should("contain.text", "1").and("not.be.disabled");
    cy.contains(".tally-slot", "Skipped").should("be.disabled");
    // Hydrated first, then clicked — a filter is component state, so a press that lands before
    // React attaches does nothing at all and the assertion below would fail on the wrong thing.
    cy.hydrated(".tally-slot");
    cy.contains(".tally-slot", "Failed").click();
    cy.contains(".tally-slot", "Failed").should("have.attr", "aria-pressed", "true");
    cy.get("table.data-table tbody tr").should("have.length", 1);
    cy.get("table.data-table tbody").should("contain.text", "shows the decline reason");
    cy.contains("1 of 4 rows").should("be.visible");

    // One Outcome column where there were two chips: `Failed` used to sit beside a second
    // chip reading `Check recorded`, which said nothing on every row that worked. The suffix
    // stripped here is the `.sr-only` sort state a sortable header carries — it is in the
    // accessible text on purpose, so it has to come out of the comparison rather than out of
    // the markup.
    cy.get("table.data-table thead th").then((headers) => {
      const columns = [...headers].map((th) =>
        th.innerText.trim().replace(/\s*\((?:sort|sorted [a-z]+)\)$/, "")
      );
      expect(columns).to.deep.equal(["#", "Test case", "Test", "Spec", "Outcome"]);
    });

    cy.contains("button", "Show all rows").click();
    cy.get("table.data-table tbody tr").should("have.length", 4);

    // And the list now carries the batch, tallied.
    cy.visit("/admin/checks");
    /*
     * The tally is a COLUMN PER OUTCOME, not one cell of chips: the words are `<th>`s and the
     * cells are figures under them, which is what lets a Lead scan one column down the page.
     * So each count is asserted against its own column by index, and the header row is checked
     * first — a cell figure means nothing if it is sitting under the wrong heading.
     *
     * All of it has to be visible at 1440px. That is the reason for the viewport
     * (`cypress.config.ts`): a column pushed outside `.table-scroll` is clipped, Cypress
     * correctly calls it "not visible", and the spec would then fail on the layout.
     */
    cy.get("table.data-table").within(() => {
      cy.get("thead th").then((headers) => {
        const columns = [...headers].map((th) => th.innerText.trim());
        expect(columns).to.deep.equal([
          "File",
          "Tests",
          "Passed",
          "Failed",
          "Errored",
          "Skipped",
          "Reached no case",
          "Ingested by",
          "Started"
        ]);
      });

      cy.contains("td", "guest-checkout.xml")
        .should("be.visible")
        .parent("tr")
        .within(() => {
          // Four tests in the file: one passed, one failed, and two that reached no case at
          // all. The last two are summed here — the batch report splits them, which is where
          // the difference between them decides what to fix.
          const cell = (index: number) => cy.get("td").eq(index);
          cell(1).should("have.text", "4"); // Tests
          cell(2).should("have.text", "1"); // Passed
          cell(3).should("have.text", "1"); // Failed
          cell(4).should("contain.text", "0"); // Errored — a dash, with the number in .sr-only
          cell(5).should("contain.text", "0"); // Skipped
          cell(6).should("have.text", "2"); // Reached no case
          // Who carried the file in. Not who verified anything — the only person a batch
          // records.
          cell(7).should("have.text", "Priya Raman");
        });
    });
  });

  it("records the checks against the test case they named", () => {
    cy.loginAs("QA_LEAD");
    /*
     * The case's own screen is where a reader asks "what did automation last see here?" — the
     * question this feature exists to answer. Two of the four rows named this case, so two
     * checks landed here, and the panel identifies them by spec and test name rather than by
     * the file (`ChecksPanel`).
     */
    cy.visit(`/test-cases/${seeded.approvedCase.id}`);
    cy.contains("h2", "Automation checks")
      .next(".card")
      .within(() => {
        cy.contains("checkout/guest.cy.ts").should("be.visible");
        cy.contains("rejects an expired card").should("be.visible");
        cy.contains("shows the decline reason").should("be.visible");
        // The runner's message, kept as a pointer to the evidence rather than the evidence.
        cy.contains("expected the decline banner to be visible").should("be.visible");
        cy.get(".state-pass").should("have.length", 1);
        cy.get(".state-fail").should("have.length", 1);

        /*
         * Both checks came out of one file, so they are one run and the panel says so. This is
         * the answer to "what did automation last see here?" — and it names a RUN rather than
         * lifting one check out, because a file stamps every check in it with one instant and
         * "the most recent check" of two simultaneous ones is decided by nothing.
         */
        cy.get(".check-run").should("have.length", 1);
        cy.contains(".check-run", "Latest run").should("contain.text", "2 checks");
        // A QA Lead may open the batch, and the link belongs to the run rather than to each
        // check in it.
        cy.get(".check-run").find('a[href^="/admin/checks/"]').should("have.length", 1);
      });
  });

  it("is absent for a role that may not ingest, rather than rejecting them", () => {
    /*
     * `page.tsx` calls `notFound()` for any role but QA Lead, so this asserts a 404 and not a
     * 403 banner. That distinction is the policy (`docs/excel-source-map.md:11` — navigation
     * derives from authorised capabilities), and it is invisible to the domain tests because
     * the service they call refuses the role either way.
     */
    cy.loginAs("QA_ENGINEER");
    cy.request({ url: "/admin/checks", failOnStatusCode: false }).its("status").should("eq", 404);

    // And the rail never offers it.
    cy.visit("/my-work");
    cy.get('nav[aria-label="Main"]').should("not.contain.text", "Automation checks");
  });
});
