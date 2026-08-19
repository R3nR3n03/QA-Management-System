"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp } from "lucide-react";
import { LocalPager } from "@/ui/local-pager";
import { pageSlice } from "@/ui/paging";
import { CHECK_FILINGS, UNRESOLVED_FILINGS, filingFor, filingKeyOf } from "../check-tone";

/**
 * One ingested results file: what it recorded, then every row in it.
 *
 * Every `<testcase>` in the file appears here, including the ones that produced no check —
 * that is the whole reason this screen exists, since a test naming a case that does not
 * exist is otherwise invisible and the run looks like it simply covered less than it did.
 *
 * Presentation only. Sorting, filtering and paging change what is on screen, never what
 * exists; the rows were written at ingestion and nothing here can alter them.
 *
 * ## Why the head is in here and not in the page
 *
 * The tallies ARE the filter, and one piece of state cannot be split across a grid the server
 * component owns — the same inversion `DESIGN-SYSTEM.md` records for `FinalizeForm` ("a form
 * may own the record's whole layout"). So this component renders `.check-head` as well as the
 * table, and the page hands it the record plus stamps already formatted for the viewer.
 *
 * Before this, the screen opened with a bare `<h1>`, one muted stamp line and then a thousand
 * rows, with the unresolved count buried in a `.why` band inside the card — below the fold on
 * any real suite. Three controls were doing one job: that band's "Show them", a lone `<select>`
 * beneath it, and nothing at all tying either to a count.
 *
 * ## Why this pages in the browser
 *
 * These rows come out of a single `CheckBatch.reportJson` column, so there is nothing to
 * re-fetch a page of — one record is one read however it is displayed. That is the exact
 * case `LocalPager` exists for (`DESIGN-SYSTEM.md`), and `admin/imports/[id]/RowsTable`
 * is the same shape over `ImportRun.reportJson`. It also leaves `getCheckBatch` alone,
 * which matters because `GET /api/v1/check-batches/{id}` returns it verbatim and that is a
 * documented API surface.
 */

export type CheckRowData = {
  /** 1-based position in the uploaded file — the run's own order, and the default sort. */
  position: number;
  businessId: string | null;
  testName: string;
  specName: string;
  /** CREATED | REFERENCE_NOT_FOUND | NO_TEST_CASE_DECLARED. */
  outcome: string;
  checkOutcome: string | null;
  /** The case this row's check landed on. Null unless the row created one. */
  testCaseId: string | null;
  failureReason: string | null;
};

type SortKey = "position" | "case" | "test" | "spec" | "outcome";

/** How much of a runner's message shows before the rest becomes a disclosure. */
const REASON_PREVIEW = 200;

/**
 * The recognisable head of a runner's message, and whatever follows it.
 *
 * Breaks on the first newline where there is one early enough, because a JUnit message is
 * usually one assertion line followed by a stack, and that first line is the part a person
 * recognises. Never a `title` attribute: the previous version clipped at 160 characters and
 * put the remainder in one, which no keyboard, no touch screen and no printed page can reach —
 * on the one screen whose whole subject is why something failed, and where
 * `docs/data-model.md` calls the spec and test name "the only thread from a failed check back
 * to the code behind it".
 */
function splitReason(reason: string): { head: string; rest: string | null } {
  const text = reason.trim();
  const newline = text.indexOf("\n");
  const cut =
    newline !== -1 && newline <= REASON_PREVIEW
      ? newline
      : text.length <= REASON_PREVIEW
        ? text.length
        : REASON_PREVIEW;
  const rest = text.slice(cut).trim();
  return { head: text.slice(0, cut), rest: rest.length > 0 ? rest : null };
}

export function BatchReport({
  fileName,
  startedAt,
  completedAt,
  counts,
  rows
}: {
  fileName: string;
  startedAt: { iso: string; label: string };
  completedAt: { iso: string; label: string } | null;
  /** The stored tallies, keyed the way `tally` in `src/domain/checks.ts` keys them. */
  counts: Record<string, number>;
  rows: CheckRowData[];
}) {
  const [sortKey, setSortKey] = useState<SortKey>("position");
  const [ascending, setAscending] = useState(true);
  /** The filing a reader has narrowed to, or null for every row. */
  const [filter, setFilter] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const unresolved = useMemo(
    () => UNRESOLVED_FILINGS.reduce((sum, filing) => sum + (counts[filing.key] ?? 0), 0),
    [counts]
  );

  const filtered = useMemo(
    () => (filter === null ? rows : rows.filter((row) => filingKeyOf(row.outcome, row.checkOutcome) === filter)),
    [rows, filter]
  );

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "position") cmp = a.position - b.position;
      else if (sortKey === "case") cmp = (a.businessId ?? "").localeCompare(b.businessId ?? "");
      else if (sortKey === "test") cmp = a.testName.localeCompare(b.testName);
      else if (sortKey === "spec") cmp = a.specName.localeCompare(b.specName);
      else {
        // Sorted by the vocabulary's own order, not alphabetically: the fixed order is what
        // makes the tally scannable, and a sort that disagreed with it would teach a reader
        // two different sequences for one set of values.
        const rank = (row: CheckRowData) =>
          CHECK_FILINGS.findIndex((f) => f.key === filingKeyOf(row.outcome, row.checkOutcome));
        cmp = rank(a) - rank(b);
      }
      // Ties fall back to the file's own order, so a sort never shuffles equal rows.
      return (ascending ? cmp : -cmp) || a.position - b.position;
    });
    return copy;
  }, [filtered, sortKey, ascending]);

  const visible = pageSlice(sorted, page);

  const toggle = (key: SortKey) => {
    if (key === sortKey) setAscending((a) => !a);
    else {
      setSortKey(key);
      setAscending(true);
    }
    // A new order renumbers every page; stale page positions would mislead.
    setPage(1);
  };

  const narrow = (key: string) => {
    setFilter((current) => (current === key ? null : key));
    setPage(1);
  };

  const header = (key: SortKey, label: string, numeric = false) => (
    // `scope="col"` rather than leaving the association to a UA heuristic — it is also
    // what makes `aria-sort` reliably interpreted.
    <th
      scope="col"
      className={numeric ? "num" : undefined}
      aria-sort={sortKey === key ? (ascending ? "ascending" : "descending") : undefined}
    >
      <button type="button" onClick={() => toggle(key)}>
        {label}
        {sortKey === key ? (
          ascending ? (
            <ChevronUp size={12} aria-hidden />
          ) : (
            <ChevronDown size={12} aria-hidden />
          )
        ) : null}
        <span className="sr-only">
          {sortKey === key ? (ascending ? " (sorted ascending)" : " (sorted descending)") : " (sort)"}
        </span>
      </button>
    </th>
  );

  return (
    <>
      <div className="check-head">
        <div>
          <h1 className="check-file-id">{fileName}</h1>
          <p className="check-stamps">
            Ingested by this deployment · started{" "}
            <time dateTime={startedAt.iso}>{startedAt.label}</time>
            {completedAt ? (
              <>
                {" · completed "}
                <time dateTime={completedAt.iso}>{completedAt.label}</time>
              </>
            ) : null}
          </p>
        </div>

        <div className="run-summary">
          <p className="run-summary-title" id="tally-heading">
            What this file recorded
          </p>
          {/*
           * A `<ul>` of real buttons, not a `<dl>`: `.run-stats` is a definition list because
           * an execution's tally is read-only, and these are controls. The precedent is `.seg`,
           * so the chosen slot is raised out of a shared trough rather than merely tinted.
           *
           * A slot counting nothing is disabled rather than hidden. Its position is what makes
           * the other five findable between batches, and an enabled control that filters to an
           * empty table is a dead end offered on purpose.
           */}
          <ul className="tally" aria-labelledby="tally-heading">
            {CHECK_FILINGS.map((filing) => {
              const n = counts[filing.key] ?? 0;
              return (
                <li key={filing.key}>
                  <button
                    type="button"
                    className="tally-slot"
                    data-tone={filing.slotTone}
                    data-zero={n === 0 ? "" : undefined}
                    disabled={n === 0}
                    aria-pressed={filter === filing.key}
                    onClick={() => narrow(filing.key)}
                  >
                    <span className="tally-n">{n}</span>
                    <span className="tally-w">{filing.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {unresolved > 0 ? (
            <p className="tally-note">
              <strong>
                {unresolved} of {rows.length} tests recorded no check.
              </strong>{" "}
              A test reaches a test case only by naming its business ID. These ones named a case
              that does not exist here, or named none — so nothing was recorded against any case
              for them.
            </p>
          ) : null}
        </div>
      </div>

      <div className="page-head">
        <h2>Rows</h2>
        <span className="muted">
          {filter === null
            ? `${rows.length} ${rows.length === 1 ? "row" : "rows"}, in file order`
            : `${filtered.length} of ${rows.length} rows · ${filingFor(filter).label}`}
        </span>
        {filter !== null ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => narrow(filter)}>
            Show all rows
          </button>
        ) : null}
      </div>

      <div className="card card-flush">
        {rows.length === 0 ? (
          <div className="empty">
            <p>The file contained no tests.</p>
          </div>
        ) : sorted.length === 0 ? (
          /* Only reachable if a stored tally and its rows disagree, which would be a defect in
             the report rather than a filter someone chose — every slot that counts nothing is
             disabled. Said plainly rather than left as an empty table. */
          <div className="empty">
            <p>No row in this file is {filingFor(filter ?? "").label}.</p>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFilter(null)}>
              Show all rows
            </button>
          </div>
        ) : (
          <>
            <div className="table-scroll">
              <table className="data-table">
                {/* Without a name this announced as an unnamed table in a screen reader's
                    table list. */}
                <caption className="sr-only">Automation check row report</caption>
                <thead>
                  <tr>
                    {header("position", "#", true)}
                    {header("case", "Test case")}
                    {header("test", "Test")}
                    {header("spec", "Spec")}
                    {header("outcome", "Outcome")}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => {
                    const filing = filingFor(filingKeyOf(row.outcome, row.checkOutcome));
                    const reason = row.failureReason === null ? null : splitReason(row.failureReason);
                    return (
                      <tr key={row.position}>
                        <td className="num muted">{row.position}</td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          {/* Linked only where a check was actually written. A row that
                              resolved to nothing has no case to point at — that is what its
                              outcome says — so an inert-looking ID here is accurate. */}
                          {row.businessId === null ? (
                            <span className="muted">—</span>
                          ) : row.testCaseId ? (
                            <Link className="bid" href={`/test-cases/${row.testCaseId}`}>
                              {row.businessId}
                            </Link>
                          ) : (
                            <span className="bid">{row.businessId}</span>
                          )}
                        </td>
                        <td>
                          <span className="check-test">{row.testName}</span>
                          {reason ? (
                            <>
                              <span className="check-said">{reason.head}</span>
                              {reason.rest ? (
                                <details className="check-said-more">
                                  <summary>Show the rest of the message</summary>
                                  <span className="check-said">{reason.rest}</span>
                                </details>
                              ) : null}
                            </>
                          ) : null}
                        </td>
                        <td className="muted">{row.specName}</td>
                        {/*
                         * ONE outcome column, where there were two. Every resolved row used to
                         * print `Passed` beside `Check recorded` — redundant on every row that
                         * worked, and informative only on the ones that did not, where it sat
                         * in the rightmost column. This reads the same `filingKeyOf` the tally
                         * counts by, so the chip and the number counting it cannot disagree.
                         */}
                        <td>
                          <span className={filing.chip}>{filing.label}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <LocalPager
              total={sorted.length}
              page={page}
              onPageChange={setPage}
              label="check row report"
            />
          </>
        )}
      </div>
    </>
  );
}
