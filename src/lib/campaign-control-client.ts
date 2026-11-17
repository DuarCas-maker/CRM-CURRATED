export async function campaignControlRequest<T>(
  path: string,
  signal?: AbortSignal,
): Promise<T> {
  const r = await fetch("/api/campaigns/control?" + path, {
    signal,
    cache: "no-store",
  });
  const result = await r.json();
  if (!r.ok)
    throw new Error(result.error || "No se pudo consultar la campaña.");
  return result;
}
export async function campaignControlAction<
  T = { id: string; queued?: number; changed?: number },
>(
  kind: string,
  payload: Record<string, unknown>,
  keys: Map<string, string>,
): Promise<T> {
  const fingerprint = JSON.stringify({ kind, payload });
  let request_key = keys.get(fingerprint);
  if (!request_key) {
    request_key = crypto.randomUUID();
    keys.set(fingerprint, request_key);
  }
  const r = await fetch("/api/campaigns/control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, payload, request_key }),
  });
  const result = await r.json();
  if (!r.ok)
    throw new Error(
      result.error ||
        "No se confirmó la operación. Revisa el estado antes de continuar.",
    );
  keys.delete(fingerprint);
  return result;
}
