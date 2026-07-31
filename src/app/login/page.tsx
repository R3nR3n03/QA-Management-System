"use client";

import { useActionState } from "react";
import { signIn, type LoginState } from "./actions";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(signIn, null);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "var(--sp-5)"
      }}
    >
      <div style={{ width: "100%", maxWidth: 380 }}>
        <p
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--ink-3)",
            marginBottom: "var(--sp-2)"
          }}
        >
          Quality Assurance Management System
        </p>
        <h1 style={{ marginBottom: "var(--sp-5)" }}>Sign in</h1>

        <div className="card">
          {state ? (
            <div className="notice" role="alert">
              <strong>{state.title}</strong>
              <span>{state.detail}</span>
            </div>
          ) : null}

          <form action={formAction}>
            <label className="field">
              <span>Email</span>
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
                autoFocus
                disabled={pending}
              />
            </label>

            <label className="field">
              <span>Password</span>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                disabled={pending}
              />
            </label>

            <button className="btn" type="submit" disabled={pending} style={{ width: "100%" }}>
              {pending ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>

        <p className="muted" style={{ marginTop: "var(--sp-4)" }}>
          Accounts are provisioned outside the application. Ask a QA Lead if you need access.
        </p>
      </div>
    </main>
  );
}
