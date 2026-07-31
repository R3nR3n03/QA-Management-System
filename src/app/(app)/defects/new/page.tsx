import { listControlledValues } from "@/domain/admin";
import { listTestCases } from "@/domain/test-cases";
import { CATALOGUE_PRIORITY, CATALOGUE_SEVERITY } from "@/lib/controlled-value-catalogues";
import { requireSession } from "@/ui/session";
import { NewDefectForm } from "./NewDefectForm";

export const dynamic = "force-dynamic";

export default async function NewDefectPage() {
  await requireSession();
  const [cases, controlled] = await Promise.all([listTestCases(), listControlledValues()]);
  const active = (catalogue: string) =>
    controlled.filter((v) => v.catalogue === catalogue && v.active).map((v) => v.value);

  return (
    <>
      <h1>New defect</h1>
      <p className="muted" style={{ marginBottom: "var(--sp-4)" }}>
        A defect always references the test case that found it.
      </p>
      <div className="card">
        <NewDefectForm
          cases={cases.map((c) => ({ id: c.id, businessId: c.businessId, title: c.title }))}
          priorities={active(CATALOGUE_PRIORITY)}
          severities={active(CATALOGUE_SEVERITY)}
        />
      </div>
    </>
  );
}
