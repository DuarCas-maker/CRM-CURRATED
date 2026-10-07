"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="auth-content" style={{ minHeight: "100vh" }}>
      <section className="auth-card">
        <h2>No pudimos cargar el espacio</h2>
        <p>
          Comprueba la conexión y la configuración de Supabase. / Check your
          connection and Supabase configuration.
        </p>
        <button className="button primary" onClick={reset}>
          Reintentar / Retry
        </button>
      </section>
    </div>
  );
}
