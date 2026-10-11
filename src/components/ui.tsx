"use client";
import { useEffect, useRef } from "react";
import { X, Inbox, LoaderCircle } from "lucide-react";
import type { Locale, Stage, Verification } from "@/lib/domain";
import { stageLabels } from "@/lib/domain";
export const t = (locale: Locale, es: string, en: string) =>
  locale === "es" ? es : en;
export function Avatar({
  name,
  small = false,
}: {
  name: string;
  small?: boolean;
}) {
  return (
    <span className={`avatar ${small ? "small" : ""}`} aria-hidden="true">
      {name
        .split(" ")
        .map((n) => n[0])
        .slice(0, 2)
        .join("")}
    </span>
  );
}
export function StageBadge({
  stage,
  locale,
}: {
  stage: Stage;
  locale: Locale;
}) {
  return (
    <span className={`badge stage-${stage}`}>
      <span />
      {stageLabels[locale][stage]}
    </span>
  );
}
export function VerificationBadge({
  status,
  locale,
}: {
  status: Verification;
  locale: Locale;
}) {
  const labels = {
    pending: ["Pendiente", "Pending"],
    valid: ["Verificado", "Verified"],
    invalid: ["Inválido", "Invalid"],
    uncertain: ["Incierto", "Uncertain"],
  };
  return (
    <span className={`verification ${status}`}>
      <span />
      {labels[status][locale === "es" ? 0 : 1]}
    </span>
  );
}
export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <div className="empty">
      <Inbox size={30} />
      <h3>{title}</h3>
      {body && <p>{body}</p>}
    </div>
  );
}
export function Modal({
  title,
  children,
  close,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close"
          onClick={close}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Field({
  label,
  name,
  type = "text",
  required = false,
  value,
  placeholder,
  children,
  min,
  max,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  value?: string | number;
  placeholder?: string;
  children?: React.ReactNode;
  min?: string | number;
  max?: string | number;
}) {
  return (
    <label className="field">
      <span>
        {label}
        {required && " *"}
      </span>
      {children ? (
        <select name={name} defaultValue={value} required={required}>
          {children}
        </select>
      ) : type === "textarea" ? (
        <textarea
          name={name}
          defaultValue={value}
          required={required}
          placeholder={placeholder}
          rows={4}
          maxLength={10000}
        />
      ) : (
        <input
          name={name}
          type={type}
          defaultValue={value}
          required={required}
          placeholder={placeholder}
          min={min}
          max={max}
          maxLength={type === "text" ? 500 : undefined}
        />
      )}
    </label>
  );
}
export function SaveButton({
  busy,
  locale,
  label,
  disabled = false,
}: {
  busy: boolean;
  locale: Locale;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      className="button primary"
      type="submit"
      disabled={busy || disabled}
    >
      {busy && <LoaderCircle size={16} className="spin" />}
      {label || t(locale, "Guardar", "Save")}
    </button>
  );
}
