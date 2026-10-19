// Stable comparisons include empty values and preserve array order. Callers sort
// selections where order is not meaningful before passing them here.
export function changeSnapshot(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
}

export type ChangeProtection = {
  element: () => HTMLElement | null;
  dirty: () => boolean;
  busy: () => boolean;
};

export function leaveState(
  entries: Iterable<ChangeProtection>,
  scope?: HTMLElement | null,
) {
  let dirty = false;
  let busy = false;
  for (const entry of entries) {
    const element = entry.element();
    if (!element || (scope && element !== scope && !scope.contains(element)))
      continue;
    dirty ||= entry.dirty();
    busy ||= entry.busy();
  }
  return { dirty, busy };
}
