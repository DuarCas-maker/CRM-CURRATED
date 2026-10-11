"use client";
import { useState, type FormEvent } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { ShieldCheck } from "lucide-react";
export default function Login({
  configured,
  demoEnabled,
}: {
  configured: boolean;
  demoEnabled: boolean;
}) {
  const [factor, setFactor] = useState("");
  const [qr, setQr] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const db = () =>
    createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      const client = db();
      if (factor) {
        const result = await client.auth.mfa.challengeAndVerify({
          factorId: factor,
          code: String(form.get("code")),
        });
        if (result.error) throw result.error;
        location.href = "/";
        return;
      }
      const login = await client.auth.signInWithPassword({
        email: String(form.get("email")),
        password: String(form.get("password")),
      });
      if (login.error) throw login.error;
      const factors = await client.auth.mfa.listFactors();
      if (factors.error) throw factors.error;
      const verified = factors.data.totp.find((f) => f.status === "verified");
      if (verified) setFactor(verified.id);
      else {
        for (const stale of factors.data.all.filter(
          (f) => f.status !== "verified",
        ))
          await client.auth.mfa.unenroll({ factorId: stale.id });
        const enroll = await client.auth.mfa.enroll({
          factorType: "totp",
          friendlyName: "Curated CRM",
        });
        if (enroll.error) throw enroll.error;
        setFactor(enroll.data.id);
        setQr(enroll.data.totp.qr_code);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-brand">
        <a className="brand" href="/login">
          <img src="/icon.svg" width="42" height="42" alt="" />
          <span>
            curated<span>FINANCIAL</span>
          </span>
        </a>
        <div>
          <h1>
            Great relationships.
            <br />
            Clear next steps.
          </h1>
          <p>
            El espacio donde cada oportunidad de financiación avanza con
            propósito.
          </p>
        </div>
        <small>CURATED FINANCIAL · PRIVATE WORKSPACE</small>
      </section>
      <section className="auth-content">
        <div className="auth-card">
          <ShieldCheck size={30} color="var(--accent)" />
          <h2 style={{ marginTop: 20 }}>
            {factor ? "Verifica tu identidad" : "Bienvenido a Curated"}
          </h2>
          <p>
            {factor
              ? "Enter the code from your authenticator. / Ingresa el código de tu aplicación de autenticación."
              : "Inicia sesión en tu espacio de trabajo. / Sign in to your workspace."}
          </p>
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
          {configured ? (
            <form onSubmit={submit}>
              {factor ? (
                <>
                  {qr && (
                    <img
                      src={
                        qr.startsWith("data:")
                          ? qr
                          : `data:image/svg+xml;utf8,${encodeURIComponent(qr)}`
                      }
                      className="totp-qr"
                      alt="Scan this QR code with your authenticator"
                    />
                  )}
                  <label className="field">
                    <span>Código / Code</span>
                    <input
                      name="code"
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      autoComplete="one-time-code"
                      required
                      autoFocus
                    />
                  </label>
                </>
              ) : (
                <>
                  <label className="field">
                    <span>Correo electrónico / Email</span>
                    <input
                      name="email"
                      type="email"
                      autoComplete="username"
                      required
                    />
                  </label>
                  <label className="field">
                    <span>Contraseña / Password</span>
                    <input
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      required
                    />
                  </label>
                </>
              )}
              <button className="button primary full" disabled={busy}>
                {busy
                  ? "Verificando…"
                  : factor
                    ? "Verificar / Verify"
                    : "Iniciar sesión / Sign in"}
              </button>
            </form>
          ) : (
            <div className="config-note">
              El espacio de producción requiere conectar Supabase. Puedes
              explorar el flujo con datos de ejemplo.
              <br />
              <br />
              Production requires a configured Supabase project.
            </div>
          )}
          {demoEnabled && (
            <a href="/demo" className="button full">
              Explorar demostración / Explore demo
            </a>
          )}
          <p className="muted" style={{ marginTop: 25, fontSize: 12 }}>
            Acceso por invitación y autenticación de dos factores.
            <br />
            Invitation-only access with two-factor authentication.
          </p>
        </div>
      </section>
    </main>
  );
}
