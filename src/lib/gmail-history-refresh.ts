import type { Locale } from "./domain";

export class HistoryRefreshError extends Error {
  constructor(
    public status: number,
    message = "",
  ) {
    super(message);
  }
}

export function historyRefreshMessage(error: unknown, locale: Locale) {
  const es = locale === "es";
  if (error instanceof HistoryRefreshError) {
    if (error.status === 401)
      return es
        ? "Tu sesión del CRM venció. Vuelve a iniciar sesión para consultar el análisis; esto no desconecta Gmail."
        : "Your CRM session expired. Sign in again to view the analysis; Gmail remains connected.";
    if (error.status === 403)
      return (
        error.message ||
        (es
          ? "Revisa tus permisos y el segundo factor del CRM."
          : "Check your CRM permissions and two-factor authentication.")
      );
    if (error.status >= 500 || !error.message)
      return es
        ? "El CRM no pudo actualizar el estado del análisis. Conservamos la última información y volveremos a consultar."
        : "The CRM could not refresh the analysis status. The last information is retained and will be refreshed again.";
    return error.message;
  }
  return es
    ? "No se pudo conectar con el CRM para actualizar el estado. Mostramos la última información disponible y reintentaremos automáticamente; este aviso no confirma que el análisis se haya detenido."
    : "Could not connect to the CRM to refresh status. The last available information is shown and will refresh automatically; this notice does not confirm that analysis has stopped.";
}

// Only read status here. Mutations must never be repeated as network retries.
export function startHistoryPolling<T>(
  url: string,
  callbacks: { data: (body: T) => void; error: (error: unknown) => void },
  options: { interval?: number; timeout?: number } = {},
) {
  let stopped = false,
    running = false,
    refreshAgain = false;
  let controller: AbortController | undefined;
  let next: ReturnType<typeof setTimeout> | undefined;
  const refresh = async () => {
    if (stopped) return;
    if (running) {
      refreshAgain = true;
      return;
    }
    clearTimeout(next);
    running = true;
    controller = new AbortController();
    const deadline = setTimeout(
      () => controller?.abort(),
      options.timeout ?? 20000,
    );
    try {
      const response = await fetch(url, {
        cache: "no-store",
        signal: controller.signal,
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || body === null)
        throw new HistoryRefreshError(
          response.status,
          typeof body?.error === "string" ? body.error : "",
        );
      if (!stopped) callbacks.data(body);
    } catch (error) {
      if (!stopped) callbacks.error(error);
    } finally {
      clearTimeout(deadline);
      running = false;
      if (!stopped) {
        next = setTimeout(
          () => void refresh(),
          refreshAgain ? 0 : (options.interval ?? 10000),
        );
        refreshAgain = false;
      }
    }
  };
  void refresh();
  return {
    refresh: () => void refresh(),
    stop: () => {
      stopped = true;
      clearTimeout(next);
      controller?.abort();
    },
  };
}

export function initialHistoryRun(
  runs: readonly { id: string; purpose: string; status: string }[],
  saved: string | null,
) {
  const available = runs.filter(
    (run) => run.purpose === "historical" || run.status === "review",
  );
  if (saved === "" || available.some((run) => run.id === saved)) return saved!;
  return (
    (
      available.find(
        (run) =>
          run.purpose === "historical" &&
          ["analyzing", "importing", "paused", "failed"].includes(run.status),
      ) ||
      available.find((run) => run.purpose === "historical") ||
      available[0]
    )?.id || ""
  );
}
