"use client";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type RefObject,
} from "react";
import type { Locale } from "@/lib/domain";
import {
  changeSnapshot,
  leaveState,
  type ChangeProtection,
} from "@/lib/unsaved-changes";

const protections = new Set<ChangeProtection>();
const savedEvent = "crm:form-saved";
function warnBeforeUnload(event: BeforeUnloadEvent) {
  const state = leaveState(protections);
  if (!state.dirty && !state.busy) return;
  event.preventDefault();
  event.returnValue = "";
}

export function useProtection(entry: ChangeProtection) {
  const latest = useRef(entry);
  latest.current = entry;
  useEffect(() => {
    const registered: ChangeProtection = {
      element: () => latest.current.element(),
      dirty: () => latest.current.dirty(),
      busy: () => latest.current.busy(),
    };
    protections.add(registered);
    if (protections.size === 1)
      window.addEventListener("beforeunload", warnBeforeUnload);
    return () => {
      protections.delete(registered);
      if (!protections.size)
        window.removeEventListener("beforeunload", warnBeforeUnload);
    };
  }, []);
}

export function useUnsavedChanges<T extends HTMLElement = HTMLDivElement>(
  value: unknown,
  busy = false,
  enabled = true,
) {
  const ref = useRef<T>(null);
  const snapshot = changeSnapshot(value);
  const [baseline, setBaseline] = useState(snapshot);
  const dirty = enabled && snapshot !== baseline;
  useProtection({
    element: () => ref.current,
    dirty: () => dirty,
    busy: () => busy,
  });
  return {
    ref,
    dirty,
    markSaved: (saved: unknown = value) => setBaseline(changeSnapshot(saved)),
  };
}

// Native forms also contain unnamed controls; FormData alone misses those and
// unchecked boxes. Keep File objects in place throughout the confirmation.
function nativeSnapshot(element: HTMLElement, formsOnly: boolean) {
  const counts = new Map<string, number>();
  return changeSnapshot(
    Array.from(
      element.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >("input,select,textarea"),
    )
      .filter(
        (field) =>
          !field.closest("[data-changes-explicit]") &&
          (!field.closest("[data-native-protected]") ||
            field.closest("[data-native-protected]") === element) &&
          (!formsOnly || !!field.closest("form")) &&
          field.closest("dialog") === element.closest("dialog") &&
          !["hidden", "submit", "button", "reset"].includes(field.type),
      )
      .map((field) => {
        const key =
          field.name ||
          field.id ||
          field.labels?.[0]?.textContent?.trim() ||
          field.tagName;
        const index = counts.get(key) || 0;
        counts.set(key, index + 1);
        const value =
          field instanceof HTMLInputElement && field.type === "file"
            ? Array.from(field.files || []).map((file) => [
                file.name,
                file.size,
                file.type,
                file.lastModified,
              ])
            : field instanceof HTMLInputElement &&
                ["checkbox", "radio"].includes(field.type)
              ? field.checked
              : field instanceof HTMLSelectElement && field.multiple
                ? Array.from(field.selectedOptions)
                    .map((option) => option.value)
                    .sort()
                : field.value;
        return [key, index, value];
      }),
  );
}

export function useNativeChanges(
  ref: RefObject<HTMLElement | null>,
  enabled = true,
  formsOnly = false,
  busy: boolean | (() => boolean) = false,
) {
  const baseline = useRef("");
  const touched = useRef(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
    const read = () => nativeSnapshot(element, formsOnly);
    let savedFrame = 0;
    baseline.current = read();
    const touch = (event: Event) => {
      if (
        event.target instanceof Element &&
        event.target.closest("dialog") === element.closest("dialog")
      )
        touched.current = true;
    };
    const saved = (event: Event) => {
      if (event.target !== element) return;
      baseline.current = read();
      touched.current = false;
      cancelAnimationFrame(savedFrame);
      savedFrame = requestAnimationFrame(() => {
        if (!touched.current) baseline.current = read();
      });
    };
    const observer = new MutationObserver(() => {
      if (!touched.current) baseline.current = read();
    });
    observer.observe(element, {
      childList: true,
      subtree: true,
      attributes: true,
    });
    element.addEventListener("input", touch, true);
    element.addEventListener("change", touch, true);
    element.addEventListener("click", touch, true);
    element.addEventListener(savedEvent, saved);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(savedFrame);
      element.removeEventListener("input", touch, true);
      element.removeEventListener("change", touch, true);
      element.removeEventListener("click", touch, true);
      element.removeEventListener(savedEvent, saved);
    };
  }, [ref, enabled, formsOnly]);
  useProtection({
    element: () => ref.current,
    dirty: () =>
      enabled &&
      touched.current &&
      !!ref.current &&
      nativeSnapshot(ref.current, formsOnly) !== baseline.current,
    busy: () => (typeof busy === "function" ? busy() : busy),
  });
}

export function markFormSaved(form: HTMLFormElement) {
  form.dispatchEvent(new Event(savedEvent));
}

export function ProtectedForm({
  busy = false,
  protect = true,
  changesRef,
  ...props
}: ComponentProps<"form"> & {
  busy?: boolean;
  protect?: boolean;
  changesRef?: RefObject<HTMLFormElement | null>;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const submitting = useRef(false);
  useNativeChanges(ref, protect, false, () => busy || submitting.current);
  return (
    <form
      {...props}
      inert={busy || props.inert}
      data-native-protected
      ref={(element) => {
        ref.current = element;
        if (changesRef) changesRef.current = element;
      }}
      onSubmit={(event) => {
        if (busy || submitting.current) {
          event.preventDefault();
          return;
        }
        submitting.current = true;
        try {
          const result = props.onSubmit?.(event);
          if (!event.defaultPrevented && typeof props.action === "string") {
            ref.current?.dispatchEvent(new Event(savedEvent));
            submitting.current = false;
          }
          Promise.resolve(result).then(
            () => {
              submitting.current = false;
            },
            () => {
              submitting.current = false;
            },
          );
        } catch (error) {
          submitting.current = false;
          throw error;
        }
      }}
    />
  );
}

export function useLeaveConfirmation(locale: Locale) {
  const [pending, setPending] = useState<{
    action: () => void;
    scope?: HTMLElement | null;
  } | null>(null);
  const requestLeave = (action: () => void, scope?: HTMLElement | null) => {
    const state = leaveState(protections, scope);
    if (state.busy) return;
    if (state.dirty) setPending({ action, scope });
    else action();
  };
  const confirmation = pending ? (
    <LeaveConfirmation
      locale={locale}
      cancel={() => setPending(null)}
      discard={() => {
        if (leaveState(protections, pending.scope).busy) return;
        setPending(null);
        pending.action();
      }}
    />
  ) : null;
  return { requestLeave, confirmation };
}

function LeaveConfirmation({
  locale,
  cancel,
  discard,
}: {
  locale: Locale;
  cancel: () => void;
  discard: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const es = locale === "es";
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="unsaved-title"
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) cancel();
      }}
    >
      <div className="modal-heading">
        <h2 id="unsaved-title">
          {es ? "¿Salir sin guardar?" : "Leave without saving?"}
        </h2>
      </div>
      <p>
        {es
          ? "Tienes cambios sin guardar. Si sales, se perderán."
          : "You have unsaved changes. Leaving will discard them."}
      </p>
      <div className="modal-footer">
        <button type="button" className="button" autoFocus onClick={cancel}>
          {es ? "Continuar editando" : "Continue editing"}
        </button>
        <button type="button" className="button primary" onClick={discard}>
          {es ? "Salir sin guardar" : "Leave without saving"}
        </button>
      </div>
    </dialog>
  );
}
