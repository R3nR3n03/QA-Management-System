"use client";

import { useActionState, useState } from "react";
import { FormNotice } from "@/ui/notice";
import type { FormState } from "@/ui/action";
import { fieldClass, fieldProps, noticeId } from "@/ui/form";
import { createTestCaseAction } from "../actions";

type Option = { id: string; businessId: string; label: string; parentId?: string };

const FORM_ID = "new-case";

/**
 * The hierarchy selects cascade — a module list only ever shows the chosen
 * product's modules — so a hierarchy mismatch is hard to express in the first
 * place. The domain still checks the chain (`HIERARCHY_MISMATCH`); this form just
 * makes the valid path the easy one.
 */
export function NewCaseForm({
  products,
  modules,
  features,
  requirements,
  priorities,
  severities,
  revisesTestCaseId
}: {
  products: Option[];
  modules: Option[];
  features: Option[];
  requirements: Option[];
  priorities: string[];
  severities: string[];
  revisesTestCaseId?: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(createTestCaseAction, null);
  const [productId, setProductId] = useState("");
  const [moduleId, setModuleId] = useState("");
  const [featureId, setFeatureId] = useState("");

  const bad = (field: string) => fieldClass(state, field);
  const moduleOptions = modules.filter((m) => m.parentId === productId);
  const featureOptions = features.filter((f) => f.parentId === moduleId);
  const requirementOptions = requirements.filter((r) => r.parentId === featureId);

  return (
    <form action={formAction}>
      {revisesTestCaseId ? <input type="hidden" name="revisesTestCaseId" value={revisesTestCaseId} /> : null}
      <FormNotice state={state} id={noticeId(FORM_ID)} />

      <fieldset className="form-section">
        <legend>Identity</legend>
        <label className={bad("businessId")}>
          <span>Test case ID</span>
          <input name="businessId" placeholder="TC-PROD001-0001" required disabled={pending} {...fieldProps(state, "businessId", FORM_ID)} />
          <span className="hint">Format TC-&lt;product tag&gt;-#### — unique across the repository.</span>
        </label>
      </fieldset>

      <fieldset className="form-section">
        <legend>Where it belongs</legend>
      <div className="form-grid-2">
        <label className={bad("productId")}>
          <span>Product</span>
          <select
            name="productId"
            required
            value={productId}
            onChange={(e) => {
              setProductId(e.target.value);
              setModuleId("");
              setFeatureId("");
            }}
            disabled={pending}
            {...fieldProps(state, "productId", FORM_ID)}
          >
            <option value="" disabled>
              Choose…
            </option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.businessId} · {p.label}
              </option>
            ))}
          </select>
        </label>

        <label className={bad("moduleId")}>
          <span>Module</span>
          <select
            name="moduleId"
            required
            value={moduleId}
            onChange={(e) => {
              setModuleId(e.target.value);
              setFeatureId("");
            }}
            disabled={pending || !productId}
            {...fieldProps(state, "moduleId", FORM_ID)}
          >
            <option value="" disabled>
              {productId ? "Choose…" : "Pick a product first"}
            </option>
            {moduleOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.businessId} · {m.label}
              </option>
            ))}
          </select>
        </label>

        <label className={bad("featureId")}>
          <span>Feature</span>
          <select
            name="featureId"
            required
            value={featureId}
            onChange={(e) => setFeatureId(e.target.value)}
            disabled={pending || !moduleId}
            {...fieldProps(state, "featureId", FORM_ID)}
          >
            <option value="" disabled>
              {moduleId ? "Choose…" : "Pick a module first"}
            </option>
            {featureOptions.map((f) => (
              <option key={f.id} value={f.id}>
                {f.businessId} · {f.label}
              </option>
            ))}
          </select>
        </label>

        <label className={bad("requirementId")}>
          <span>Requirement</span>
          <select name="requirementId" required disabled={pending || !featureId} defaultValue="" {...fieldProps(state, "requirementId", FORM_ID)}>
            <option value="" disabled>
              {featureId ? "Choose…" : "Pick a feature first"}
            </option>
            {requirementOptions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.businessId} · {r.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      </fieldset>

      <fieldset className="form-section">
        <legend>Planning</legend>
      <div className="form-grid-4">
        <label className={bad("cycle")}>
          <span>Cycle</span>
          <input name="cycle" required disabled={pending} {...fieldProps(state, "cycle", FORM_ID)} />
        </label>
        <label className={bad("sprint")}>
          <span>Sprint</span>
          <input name="sprint" required disabled={pending} {...fieldProps(state, "sprint", FORM_ID)} />
        </label>
        <label className={bad("release")}>
          <span>Release</span>
          <input name="release" required disabled={pending} {...fieldProps(state, "release", FORM_ID)} />
        </label>
        <label className={bad("environment")}>
          <span>Environment</span>
          <input name="environment" required disabled={pending} {...fieldProps(state, "environment", FORM_ID)} />
        </label>
      </div>
      </fieldset>

      <fieldset className="form-section">
        <legend>Classification</legend>
      <div className="form-grid-2">
        <label className={bad("priority")}>
          <span>Priority</span>
          <select name="priority" required defaultValue="" disabled={pending} {...fieldProps(state, "priority", FORM_ID)}>
            <option value="" disabled>
              Choose…
            </option>
            {priorities.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className={bad("severity")}>
          <span>Severity</span>
          <select name="severity" required defaultValue="" disabled={pending} {...fieldProps(state, "severity", FORM_ID)}>
            <option value="" disabled>
              Choose…
            </option>
            {severities.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
      </fieldset>

      <fieldset className="form-section">
        <legend>What it verifies</legend>
      <label className={bad("title")}>
        <span>Title</span>
        <input name="title" required disabled={pending} {...fieldProps(state, "title", FORM_ID)} />
      </label>
      <label className={bad("objective")}>
        <span>Objective</span>
        <textarea name="objective" rows={2} required disabled={pending} {...fieldProps(state, "objective", FORM_ID)} />
      </label>
      <label className={bad("expectedResult")}>
        <span>Expected result</span>
        <textarea name="expectedResult" rows={2} required disabled={pending} {...fieldProps(state, "expectedResult", FORM_ID)} />
      </label>
      </fieldset>

      <p className="muted" style={{ marginBottom: "var(--sp-4)" }}>
        The case is created in Draft. Add steps on the next screen — it needs at least one before it
        can be submitted for review.
      </p>

      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create draft"}
      </button>
    </form>
  );
}
