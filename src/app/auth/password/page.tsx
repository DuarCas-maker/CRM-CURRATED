"use client";
import { createBrowserClient } from "@supabase/ssr";
import { useState } from "react";
export default function PasswordPage() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="auth-content" style={{ minHeight: "100vh" }}>
      <form
        className="auth-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const form = new FormData(e.currentTarget);
          const client = createBrowserClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          );
          const result = await client.auth.updateUser({
            password: String(form.get("password")),
          });
          if (result.error) {
            setError(result.error.message);
            setBusy(false);
          } else {
            await client.auth.signOut();
            location.href = "/login";
          }
        }}
      >
        <h2>Activa tu acceso / Activate access</h2>
        <p>Crea tu contraseña; después configurarás el segundo factor.</p>
        {error && <p className="error-banner">{error}</p>}
        <label className="field">
          <span>Nueva contraseña / New password</span>
          <input
            name="password"
            type="password"
            minLength={12}
            autoComplete="new-password"
            required
          />
        </label>
        <button className="button primary" disabled={busy}>
          Guardar / Save
        </button>
      </form>
    </main>
  );
}
