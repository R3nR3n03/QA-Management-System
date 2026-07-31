import { QamsRole } from "@prisma/client";
import { notFound } from "next/navigation";
import { listControlledValues } from "@/domain/admin";
import { requireSession } from "@/ui/session";
import { ToggleForm } from "./ToggleForm";

export const dynamic = "force-dynamic";

export default async function ControlledValuesPage() {
  const auth = await requireSession();
  // Lead-only screen: absent rather than present-and-rejecting for other roles
  // (the domain services behind it refuse them regardless).
  if (auth.role !== QamsRole.QA_LEAD) notFound();
  const rows = await listControlledValues();
  const catalogues = [...new Set(rows.map((row) => row.catalogue))];

  return (
    <>
      <h1>Controlled values</h1>
      <p className="muted" style={{ marginBottom: "var(--sp-4)" }}>
        Deactivating a value stops new records from using it; existing records keep it. The workbook
        seed never reactivates a value deactivated here.
      </p>

      {catalogues.map((catalogue) => (
        <div key={catalogue}>
          <h2>{catalogue}</h2>
          <div className="card" style={{ padding: 0, marginBottom: "var(--sp-5)" }}>
            {rows
              .filter((row) => row.catalogue === catalogue)
              .map((row) => (
                <div
                  key={row.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--sp-4)",
                    padding: "var(--sp-3) var(--sp-5)",
                    borderBottom: "1px solid var(--line-soft)"
                  }}
                >
                  <span style={{ flex: 1, fontWeight: 600, color: row.active ? "var(--ink)" : "var(--ink-3)" }}>
                    {row.value}
                  </span>
                  <span className={row.active ? "state state-pass" : "state"}>
                    {row.active ? "Active" : "Inactive"}
                  </span>
                  <ToggleForm id={row.id} version={row.version} active={row.active} />
                </div>
              ))}
          </div>
        </div>
      ))}
    </>
  );
}
