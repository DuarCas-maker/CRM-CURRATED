export default function Loading() {
  return (
    <main style={{ padding: 40 }} aria-busy="true">
      <h1>Pipeline OS</h1>
      <p role="status">Cargando operación… / Loading workspace…</p>
    </main>
  );
}
