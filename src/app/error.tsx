"use client";
export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div className="auth-content" style={{ minHeight: "100vh" }}>
      <section className="auth-card">
        <h2>No pudimos cargar el espacio</h2>
        <p>
          No se pudo completar la carga. Intenta de nuevo. Si el problema
          continúa, comparte la referencia del error con el administrador. / The
          workspace could not be loaded. Try again. If the problem persists,
          share the error reference with your administrator.
        </p>
        {error.digest && <p>Referencia / Reference: {error.digest}</p>}
        <button className="button primary" onClick={retry}>
          Reintentar / Retry
        </button>
      </section>
    </div>
  );
}
