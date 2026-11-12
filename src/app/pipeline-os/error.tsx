"use client";
export default function PipelineError({ reset }: { reset: () => void }) {
  return (
    <main style={{ padding: 40 }}>
      <h1>Pipeline OS</h1>
      <p role="alert">
        No se pudo cargar la operación. / Could not load the workspace.
      </p>
      <button onClick={reset}>Reintentar / Retry</button>
      <p>
        <a href="/">Volver al CRM / Back to CRM</a>
      </p>
    </main>
  );
}
